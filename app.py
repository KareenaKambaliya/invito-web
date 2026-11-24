import os
import sys
import subprocess
import time
from threading import Lock, Thread
import io
import json
import zipfile
import urllib.parse
from datetime import datetime

import pandas as pd
from flask import Flask, render_template, request, jsonify, Response, send_file, send_from_directory

import create_invitation

# PyInstaller compatibility
if getattr(sys, 'frozen', False):
    template_folder = os.path.join(sys._MEIPASS, 'templates')
    static_folder = os.path.join(sys._MEIPASS, 'static')
    app = Flask(__name__, template_folder=template_folder, static_folder=static_folder)
else:
    app = Flask(__name__)

# State and Locks
process_lock = Lock()
current_process = None

LOG_FILE = "whatsapp_sender.log"
EXCEL_FILE = "contacts.xlsx"
TEMPLATE_FILE = "template.pdf"
NAME_POS_FILE = "name_position.json"
SENT_STATUS_FILE = "sent_status.json"
INVITATIONS_DIR = "invitations"
MESSAGE_TEMPLATE_FILE = "message_template.txt"

DEFAULT_MESSAGE = """🌸 હાર્દિક આમંત્રણ 🌸

માનનીય *{{name}}*,

શ્રી *મુકેશભાઈ કાંબલિયા* તરફથી
તેમની લાડકી પુત્રી કરીનાના લગ્ન પ્રસંગે,
આપને હાર્દિક આમંત્રણ પાઠવવામાં આવે છે.

આ શુભ અવસર પર આપની ઉપસ્થિતિ,
આશીર્વાદ અને સ્નેહની ઉપસ્થિતિ અમૂલ્ય રહેશે. 💐

સાદર આમંત્રણ,
*શ્રી મુકેશભાઈ ડોસાભાઈ કાંબલિયા તથા પરિવાર,*

*સુખપુર,જૂનાગઢ.*"""

# Generation batch progress tracking
generation_state = {
    "is_running": False,
    "current": 0,
    "total": 0,
    "percent": 0,
    "current_name": "",
    "error": None,
    "completed": False,
    "started_at": None,
    "finished_at": None
}
gen_lock = Lock()


def ensure_initial_setup():
    """Ensure template and sample data exist on startup if missing."""
    os.makedirs(INVITATIONS_DIR, exist_ok=True)
    
    # If template.pdf is missing but original exists, copy it
    if not os.path.exists(TEMPLATE_FILE):
        if os.path.exists("Invitation From Kambaliya Family.pdf"):
            import shutil
            shutil.copy("Invitation From Kambaliya Family.pdf", TEMPLATE_FILE)
            
    # If name_position.json is missing, create default
    if not os.path.exists(NAME_POS_FILE):
        default_pos = {
            "x": 566,
            "y": 313,
            "template_type": "pdf",
            "template_path": TEMPLATE_FILE,
            "pdf_x": 283.0,
            "pdf_y": 156.5,
            "page": 0,
            "fontsize": 36,
            "color": [220, 14, 14]
        }
        with open(NAME_POS_FILE, "w", encoding="utf-8") as f:
            json.dump(default_pos, f, indent=2)

    # If contacts.xlsx is missing, create a sample
    if not os.path.exists(EXCEL_FILE):
        sample_df = pd.DataFrame([
            {"Name": "શ્રી રમેશભાઈ પટેલ", "Number": "919876543210"},
            {"Name": "શ્રી મુકેશભાઈ શાહ", "Number": "919823456789"},
            {"Name": "શ્રી રાજેશભાઈ મહેતા", "Number": "919712345678"}
        ])
        with pd.ExcelWriter(EXCEL_FILE, engine="openpyxl") as writer:
            sample_df.to_excel(writer, index=False, sheet_name="Contacts")

    # If message_template.txt is missing, create default
    if not os.path.exists(MESSAGE_TEMPLATE_FILE):
        with open(MESSAGE_TEMPLATE_FILE, "w", encoding="utf-8") as f:
            f.write(DEFAULT_MESSAGE)


ensure_initial_setup()


def get_sent_status_dict():
    if os.path.exists(SENT_STATUS_FILE):
        try:
            with open(SENT_STATUS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_sent_status_dict(data):
    with open(SENT_STATUS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def safe_filename(name: str) -> str:
    """Filter out forbidden filesystem characters while preserving Unicode/Gujarati vowels."""
    cleaned = "".join(c for c in str(name) if c not in '<>:"/\\|?*\n\r\t\0').strip()
    return cleaned if cleaned else "invitation"


def read_contacts_list():
    if not os.path.exists(EXCEL_FILE):
        return []
    try:
        df = pd.read_excel(EXCEL_FILE, dtype=str)
        # Normalize column names
        cols = {str(c).strip().lower(): c for c in df.columns}
        name_col = cols.get("name") or list(df.columns)[0]
        number_col = cols.get("number") or (list(df.columns)[1] if len(df.columns) > 1 else None)

        sent_status = get_sent_status_dict()
        contacts = []
        for idx, row in df.iterrows():
            raw_name = str(row[name_col]).strip() if pd.notna(row[name_col]) else f"Contact {idx+1}"
            raw_num = str(row[number_col]).strip() if number_col and pd.notna(row[number_col]) else ""
            clean_num = "".join(filter(str.isdigit, raw_num))
            
            # Check if invitation already generated
            clean_name = safe_filename(raw_name)
            pdf_path = os.path.join(INVITATIONS_DIR, f"{clean_name}.pdf")
            img_path = os.path.join(INVITATIONS_DIR, f"{clean_name}.png")
            has_invitation = os.path.exists(pdf_path) or os.path.exists(img_path)
            invitation_file = f"{clean_name}.pdf" if os.path.exists(pdf_path) else (f"{clean_name}.png" if os.path.exists(img_path) else None)

            contacts.append({
                "id": int(idx),
                "name": raw_name,
                "number": clean_num or raw_num,
                "has_invitation": has_invitation,
                "invitation_file": invitation_file,
                "is_sent": bool(sent_status.get(str(idx), False))
            })
        return contacts
    except Exception as e:
        print(f"Error reading contacts: {e}")
        return []


# ===================== ROUTES =====================

@app.route("/")
def index():
    return render_template("index.html")


# --- Template APIs ---

@app.route("/api/template/info", methods=["GET"])
def template_info():
    target = TEMPLATE_FILE if os.path.exists(TEMPLATE_FILE) else "Invitation From Kambaliya Family.pdf"
    info = create_invitation.get_template_info(target)
    
    # Also attach current name_position
    pos = {}
    if os.path.exists(NAME_POS_FILE):
        try:
            with open(NAME_POS_FILE, "r", encoding="utf-8") as f:
                pos = json.load(f)
        except Exception:
            pass
    info["position"] = pos
    return jsonify({"success": True, "info": info})


@app.route("/api/template/page/<int:page_num>", methods=["GET"])
def template_page(page_num):
    """Serve a rendered PNG of the template's specified page."""
    target = TEMPLATE_FILE if os.path.exists(TEMPLATE_FILE) else "Invitation From Kambaliya Family.pdf"
    try:
        scale = float(request.args.get("scale", 2.0))
        img_bytes, width, height, total_pages = create_invitation.render_template_page_bytes(target, page_num, scale)
        resp = Response(img_bytes, mimetype="image/png")
        resp.headers["X-Total-Pages"] = str(total_pages)
        resp.headers["X-Page-Width"] = str(width)
        resp.headers["X-Page-Height"] = str(height)
        resp.headers["Cache-Control"] = "no-cache"
        return resp
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400


@app.route("/api/template/preview", methods=["POST"])
def template_preview():
    """Generate and return a live PNG preview with positioned text."""
    target = TEMPLATE_FILE if os.path.exists(TEMPLATE_FILE) else "Invitation From Kambaliya Family.pdf"
    data = request.json or {}
    name = data.get("name", "માનનીય શ્રી રમેશભાઈ પટેલ")
    pos_config = {
        "page": int(data.get("page", 0)),
        "x": float(data.get("x", 566)),
        "y": float(data.get("y", 313)),
        "pdf_x": float(data.get("pdf_x", 283.0)),
        "pdf_y": float(data.get("pdf_y", 156.5)),
        "fontsize": int(data.get("fontsize", 36)),
        "color": data.get("color", [220, 14, 14])
    }
    try:
        preview_bytes = create_invitation.render_preview_bytes(target, name, pos_config)
        return Response(preview_bytes, mimetype="image/png")
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# --- Position Configuration ---

@app.route("/api/position", methods=["GET"])
def get_position():
    if os.path.exists(NAME_POS_FILE):
        try:
            with open(NAME_POS_FILE, "r", encoding="utf-8") as f:
                return jsonify({"success": True, "position": json.load(f)})
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 500
    return jsonify({"success": False, "error": "Position file not found"}), 404


@app.route("/api/position", methods=["POST"])
def save_position():
    data = request.json
    if not data:
        return jsonify({"success": False, "error": "No data provided"}), 400

    target = TEMPLATE_FILE if os.path.exists(TEMPLATE_FILE) else "Invitation From Kambaliya Family.pdf"
    is_pdf = target.lower().endswith(".pdf")
    render_scale = 2.0 if is_pdf else 1.0

    x = float(data.get("x", 566))
    y = float(data.get("y", 313))
    pdf_x = float(data.get("pdf_x", x / render_scale)) if is_pdf else None
    pdf_y = float(data.get("pdf_y", y / render_scale)) if is_pdf else None

    pos_data = {
        "x": x,
        "y": y,
        "template_type": "pdf" if is_pdf else "image",
        "template_path": target,
        "pdf_x": pdf_x,
        "pdf_y": pdf_y,
        "page": int(data.get("page", 0)),
        "fontsize": int(data.get("fontsize", 36)),
        "color": data.get("color", [220, 14, 14])
    }

    try:
        with open(NAME_POS_FILE, "w", encoding="utf-8") as f:
            json.dump(pos_data, f, indent=2)
        return jsonify({"success": True, "message": "Name position and styling saved successfully.", "position": pos_data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# --- Uploads ---

@app.route("/upload", methods=["POST"])
def upload_file():
    if "file" not in request.files:
        return jsonify({"success": False, "error": "No file uploaded."}), 400
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"success": False, "error": "No file selected."}), 400

    lower = file.filename.lower()
    if lower.endswith(".xlsx") or lower.endswith(".xls") or lower.endswith(".csv"):
        try:
            if lower.endswith(".csv"):
                df = pd.read_csv(file)
                df.to_excel(EXCEL_FILE, index=False, engine="openpyxl")
            else:
                file.save(EXCEL_FILE)

            contacts = read_contacts_list()
            return jsonify({
                "success": True,
                "message": f"Uploaded {len(contacts)} contacts successfully.",
                "count": len(contacts),
                "contacts": contacts
            })
        except Exception as e:
            return jsonify({"success": False, "error": f"Failed to parse file: {str(e)}"}), 400

    return jsonify({"success": False, "error": "Invalid format. Please upload an Excel (.xlsx, .xls) or CSV file."}), 400


@app.route("/upload-pdf", methods=["POST"])
def upload_pdf():
    if "file" not in request.files:
        return jsonify({"success": False, "error": "No file uploaded."}), 400
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"success": False, "error": "No file selected."}), 400

    lower = file.filename.lower()
    if lower.endswith(".pdf") or lower.endswith(".jpg") or lower.endswith(".jpeg") or lower.endswith(".png"):
        save_name = TEMPLATE_FILE if lower.endswith(".pdf") else "template" + os.path.splitext(file.filename)[1]
        file.save(save_name)

        # Update name_position.json template path
        if os.path.exists(NAME_POS_FILE):
            try:
                with open(NAME_POS_FILE, "r", encoding="utf-8") as f:
                    pos = json.load(f)
                pos["template_type"] = "pdf" if lower.endswith(".pdf") else "image"
                pos["template_path"] = save_name
                with open(NAME_POS_FILE, "w", encoding="utf-8") as f:
                    json.dump(pos, f, indent=2)
            except Exception:
                pass

        info = create_invitation.get_template_info(save_name)
        return jsonify({
            "success": True,
            "message": "Template uploaded successfully.",
            "info": info
        })

    return jsonify({"success": False, "error": "Invalid template type. Please upload a PDF or image file (JPEG, PNG)."}), 400


# --- Contacts CRUD ---

@app.route("/api/contacts", methods=["GET"])
def get_contacts():
    contacts = read_contacts_list()
    return jsonify({"success": True, "contacts": contacts, "count": len(contacts)})


@app.route("/api/contacts", methods=["POST"])
def add_contact():
    data = request.json or {}
    name = str(data.get("name", "")).strip()
    number = str(data.get("number", "")).strip()
    if not name:
        return jsonify({"success": False, "error": "Contact name is required."}), 400

    try:
        if os.path.exists(EXCEL_FILE):
            df = pd.read_excel(EXCEL_FILE, dtype=str)
        else:
            df = pd.DataFrame(columns=["Name", "Number"], dtype=str)
        
        new_row = pd.DataFrame([{"Name": name, "Number": number}], dtype=str)
        df = pd.concat([df, new_row], ignore_index=True)
        df.to_excel(EXCEL_FILE, index=False, engine="openpyxl")
        return jsonify({"success": True, "message": "Contact added successfully.", "contacts": read_contacts_list()})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/contacts/<int:contact_id>", methods=["PUT"])
def edit_contact(contact_id):
    data = request.json or {}
    name = str(data.get("name", "")).strip()
    number = str(data.get("number", "")).strip()

    try:
        df = pd.read_excel(EXCEL_FILE, dtype=str)
        if 0 <= contact_id < len(df):
            name_col = [c for c in df.columns if "name" in str(c).lower()]
            num_col = [c for c in df.columns if "num" in str(c).lower()]
            col_name = name_col[0] if name_col else df.columns[0]
            col_num = num_col[0] if num_col else df.columns[1]

            if name:
                df.at[contact_id, col_name] = str(name)
            if number:
                df.at[contact_id, col_num] = str(number)
            df.to_excel(EXCEL_FILE, index=False, engine="openpyxl")
            return jsonify({"success": True, "message": "Contact updated.", "contacts": read_contacts_list()})
        return jsonify({"success": False, "error": "Contact ID not found."}), 404
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/contacts/<int:contact_id>", methods=["DELETE"])
def delete_contact(contact_id):
    try:
        df = pd.read_excel(EXCEL_FILE, dtype=str)
        if 0 <= contact_id < len(df):
            df = df.drop(index=contact_id).reset_index(drop=True)
            df.to_excel(EXCEL_FILE, index=False, engine="openpyxl")
            return jsonify({"success": True, "message": "Contact deleted.", "contacts": read_contacts_list()})
        return jsonify({"success": False, "error": "Contact ID not found."}), 404
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/download-template", methods=["GET"])
def download_template():
    df = pd.DataFrame(columns=["Name", "Number"])
    df.loc[0] = ["શ્રી રમેશભાઈ પટેલ", "919876543210"]
    df.loc[1] = ["Sample Friend Name", "919123456789"]

    out = io.BytesIO()
    with pd.ExcelWriter(out, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Contacts")
        worksheet = writer.sheets["Contacts"]
        worksheet.column_dimensions["A"].width = 30
        worksheet.column_dimensions["B"].width = 20

    out.seek(0)
    return send_file(
        out,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name="contacts_template.xlsx"
    )


# --- Message Template ---

@app.route("/api/message", methods=["GET"])
def get_message():
    if os.path.exists(MESSAGE_TEMPLATE_FILE):
        try:
            with open(MESSAGE_TEMPLATE_FILE, "r", encoding="utf-8") as f:
                content = f.read()
                if content.strip():
                    return jsonify({"success": True, "message": content})
        except Exception:
            pass
    return jsonify({"success": True, "message": DEFAULT_MESSAGE})


@app.route("/api/message", methods=["POST"])
def save_message():
    data = request.json or {}
    if "message" not in data:
        return jsonify({"success": False, "error": "No message provided."}), 400
    try:
        with open(MESSAGE_TEMPLATE_FILE, "w", encoding="utf-8") as f:
            f.write(data["message"])
        return jsonify({"success": True, "message": "Message template saved successfully."})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# --- Bulk Generation & Batch Download ---

def _run_batch_generation():
    global generation_state
    contacts = read_contacts_list()
    total = len(contacts)
    if total == 0:
        with gen_lock:
            generation_state["is_running"] = False
            generation_state["completed"] = True
            generation_state["error"] = "No contacts found to generate."
        return

    os.makedirs(INVITATIONS_DIR, exist_ok=True)
    with gen_lock:
        generation_state["is_running"] = True
        generation_state["current"] = 0
        generation_state["total"] = total
        generation_state["percent"] = 0
        generation_state["completed"] = False
        generation_state["error"] = None
        generation_state["started_at"] = datetime.now().isoformat()

    for idx, c in enumerate(contacts):
        name = c["name"]
        with gen_lock:
            generation_state["current"] = idx + 1
            generation_state["current_name"] = name
            generation_state["percent"] = int(((idx + 1) / total) * 100)

        clean_name = safe_filename(name)
        out_path = os.path.join(INVITATIONS_DIR, f"{clean_name}.pdf")

        try:
            create_invitation.create_personalized_invitation(name, out_path)
        except Exception as e:
            print(f"Failed to generate for '{name}': {e}")

        time.sleep(0.05)

    with gen_lock:
        generation_state["is_running"] = False
        generation_state["completed"] = True
        generation_state["finished_at"] = datetime.now().isoformat()


@app.route("/api/generate-batch", methods=["POST"])
def generate_batch():
    global generation_state
    with gen_lock:
        if generation_state["is_running"]:
            return jsonify({"success": False, "error": "Generation is already in progress."}), 400

    Thread(target=_run_batch_generation, daemon=True).start()
    return jsonify({"success": True, "message": "Bulk invitation generation started."})


@app.route("/api/generate-progress", methods=["GET"])
def generate_progress():
    with gen_lock:
        return jsonify(dict(generation_state))


@app.route("/api/generated-files", methods=["GET"])
def list_generated_files():
    if not os.path.exists(INVITATIONS_DIR):
        return jsonify({"success": True, "files": [], "count": 0})

    files = []
    for f in os.listdir(INVITATIONS_DIR):
        if f.lower().endswith((".pdf", ".png", ".jpg", ".jpeg")):
            path = os.path.join(INVITATIONS_DIR, f)
            stat = os.stat(path)
            files.append({
                "filename": f,
                "size_kb": round(stat.st_size / 1024, 1),
                "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%d-%m-%Y %H:%M"),
                "preview_url": f"/api/preview/{urllib.parse.quote(f)}",
                "download_url": f"/api/preview/{urllib.parse.quote(f)}?download=1"
            })
    files.sort(key=lambda x: x["filename"])
    return jsonify({"success": True, "files": files, "count": len(files)})


@app.route("/api/preview/<filename>")
def preview_file(filename):
    as_attachment = request.args.get("download") == "1"
    safe_name = os.path.basename(filename)
    return send_from_directory(INVITATIONS_DIR, safe_name, as_attachment=as_attachment)


@app.route("/api/download-all-zip", methods=["GET"])
def download_all_zip():
    if not os.path.exists(INVITATIONS_DIR):
        return jsonify({"success": False, "error": "No invitations generated yet."}), 400

    files = [f for f in os.listdir(INVITATIONS_DIR) if f.lower().endswith((".pdf", ".png", ".jpg", ".jpeg"))]
    if not files:
        return jsonify({"success": False, "error": "No generated invitation files found."}), 400

    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            file_path = os.path.join(INVITATIONS_DIR, f)
            zf.write(file_path, arcname=f)

    memory_file.seek(0)
    return send_file(
        memory_file,
        mimetype="application/zip",
        as_attachment=True,
        download_name="personalized_invitations.zip"
    )


# --- WhatsApp Web & Queue Dispatcher ---

@app.route("/api/whatsapp/queue", methods=["GET"])
def whatsapp_queue():
    contacts = read_contacts_list()
    msg_template = DEFAULT_MESSAGE
    if os.path.exists(MESSAGE_TEMPLATE_FILE):
        try:
            with open(MESSAGE_TEMPLATE_FILE, "r", encoding="utf-8") as f:
                c = f.read()
                if c.strip():
                    msg_template = c
        except Exception:
            pass

    queue = []
    for c in contacts:
        # Format message
        personalized = msg_template.replace("{{name}}", c["name"]).replace("{{number}}", c["number"])
        clean_num = "".join(filter(str.isdigit, c["number"]))
        
        # Add country code 91 if 10 digits
        if len(clean_num) == 10:
            intl_num = "91" + clean_num
        else:
            intl_num = clean_num

        encoded_text = urllib.parse.quote(personalized)
        web_url = f"https://web.whatsapp.com/send?phone={intl_num}&text={encoded_text}"
        mobile_url = f"https://api.whatsapp.com/send?phone={intl_num}&text={encoded_text}"

        queue.append({
            "id": c["id"],
            "name": c["name"],
            "number": c["number"],
            "intl_number": intl_num,
            "personalized_message": personalized,
            "web_url": web_url,
            "mobile_url": mobile_url,
            "has_invitation": c["has_invitation"],
            "invitation_file": c["invitation_file"],
            "is_sent": c["is_sent"]
        })

    return jsonify({"success": True, "queue": queue, "total": len(queue)})


@app.route("/api/whatsapp/mark-sent", methods=["POST"])
def mark_sent():
    data = request.json or {}
    contact_id = str(data.get("contact_id"))
    is_sent = bool(data.get("is_sent", True))

    status_dict = get_sent_status_dict()
    status_dict[contact_id] = is_sent
    save_sent_status_dict(status_dict)

    return jsonify({"success": True, "contact_id": contact_id, "is_sent": is_sent})


# --- Legacy / Headless Automation Process Management ---

@app.route("/api/run", methods=["POST"])
def run_automation():
    global current_process

    with process_lock:
        if current_process is not None and current_process.poll() is None:
            return jsonify({"success": False, "error": "Automation is already running."}), 400

        data = request.json or {}
        mode = data.get("mode", "full")
        no_preview = data.get("no_preview", True)

        open(LOG_FILE, 'w').close()

        cmd = [sys.executable, "--run-automation", mode, str(no_preview), EXCEL_FILE]

        try:
            creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            current_process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                creationflags=creationflags
            )
            return jsonify({"success": True, "message": "Automated WhatsApp sender started."})
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/status", methods=["GET"])
def get_status():
    global current_process
    is_running = False
    if current_process is not None and current_process.poll() is None:
        is_running = True
    return jsonify({"is_running": is_running})


@app.route("/api/stop", methods=["POST"])
def stop_automation():
    global current_process
    with process_lock:
        if current_process is not None and current_process.poll() is None:
            current_process.terminate()
            current_process = None
            return jsonify({"success": True, "message": "Automation stopped."})
        return jsonify({"success": False, "error": "No automation is currently running."}), 400


@app.route("/api/logs")
def stream_logs():
    def generate():
        position = 0
        while True:
            is_running = False
            if current_process is not None and current_process.poll() is None:
                is_running = True

            try:
                if os.path.exists(LOG_FILE):
                    with open(LOG_FILE, 'r', encoding='utf-8') as f:
                        f.seek(position)
                        for line in f:
                            yield f"data: {line}\n\n"
                        position = f.tell()
            except Exception:
                pass

            if not is_running:
                try:
                    if os.path.exists(LOG_FILE):
                        with open(LOG_FILE, 'r', encoding='utf-8') as f:
                            f.seek(position)
                            for line in f:
                                yield f"data: {line}\n\n"
                except Exception:
                    pass
                yield "event: close\ndata: \n\n"
                break
            time.sleep(0.5)

    return Response(generate(), mimetype='text/event-stream')


if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()

    if len(sys.argv) > 1:
        if sys.argv[1] == "--run-position-ui":
            import select_name_position1
            sys.exit(0)
            
        if sys.argv[1] == "--run-automation":
            import whatsapp_sender
            mode = sys.argv[2]
            no_preview = sys.argv[3] == "True"
            excel_file = sys.argv[4]
            whatsapp_sender.run_automation(mode=mode, no_preview=no_preview, excel_file=excel_file)
            sys.exit(0)

    port = int(os.environ.get("PORT", 5000))
    host = os.environ.get("HOST", "127.0.0.1")
    print(f"Starting INVITO Web Server on http://{host}:{port}/")
    app.run(host=host, port=port, debug=False)
