from PIL import Image, ImageDraw, ImageFont
import os
import json
import io
import urllib.request


DEFAULT_INVITATION_TEXT = (
    "✨ You are cordially invited ✨\n\n"
    "Please join us for this special occasion.\n"
    "Your presence and blessings are cherished."
)


def ensure_gujarati_font(dest_filename='NotoSerifGujarati-Regular.ttf'):
    """Ensure a Gujarati-capable TTF exists in the project root.

    Prefer the Noto Serif Gujarati family. If missing, try to download it from
    the Google Fonts GitHub repository. Returns the absolute path to the font
    file if available, otherwise returns None.
    """
    possible_names = [
        dest_filename,
        'NotoSerifGujarati-Regular.ttf',
        'NotoSerifGujarati.ttf',
        'NotoSansGujarati-Regular.ttf',
        'NotoSansGujarati.ttf',
        'Lohit-Gujarati.ttf',
        'gujarati.ttf',
        'FreeSerif.ttf',
    ]
    for name in possible_names:
        if os.path.exists(name):
            return os.path.abspath(name)

    # Try to download Noto Serif Gujarati
    url = 'https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSerifGujarati/NotoSerifGujarati-Regular.ttf'
    try:
        print(f"Downloading Gujarati serif font to {dest_filename}...")
        urllib.request.urlretrieve(url, dest_filename)
        if os.path.exists(dest_filename):
            return os.path.abspath(dest_filename)
    except Exception as e:
        print(f"Could not download Gujarati font automatically: {e}")

    return None

# No need for template creation since we use invitation2.jpeg as template

if __name__ == "__main__":
    print("Template creation not needed - using existing Wedding_invitation.jpeg")


def create_personalized_invitation(name: str, out_path: str, invitation_text: str | None = None):
    """
    Create a personalized invitation by adding name to the existing template.
    Uses template type and position from name_position.json
    """
    # Load name position and template info
    name_pos_file = os.path.join(os.path.dirname(__file__), "name_position.json")
    if not os.path.exists(name_pos_file):
        raise FileNotFoundError("Name position is not set. Please set position in the web editor first.")
        
    with open(name_pos_file, 'r', encoding='utf-8') as f:
        pos = json.load(f)
        
    template_type = pos.get('template_type', 'pdf')  # Default to pdf
    template_path = pos.get('template_path', 'template.pdf')
    
    if not template_path or not os.path.exists(template_path):
        # Fallback check
        if os.path.exists('template.pdf'):
            template_path = 'template.pdf'
        elif os.path.exists('Invitation From Kambaliya Family.pdf'):
            template_path = 'Invitation From Kambaliya Family.pdf'
        else:
            raise FileNotFoundError(f"Template not found: {template_path}")
    
    fontsize = int(pos.get('fontsize', 36))
    raw_color = pos.get('color', [220, 14, 14])
    if isinstance(raw_color, list):
        color = tuple(raw_color[:3])
    elif isinstance(raw_color, tuple):
        color = raw_color[:3]
    else:
        color = (220, 14, 14)

    if template_type == 'pdf' or template_path.lower().endswith('.pdf'):
        pdf_x = pos.get('pdf_x', pos.get('x', 0) / 2.0)
        pdf_y = pos.get('pdf_y', pos.get('y', 0) / 2.0)
        page = int(pos.get('page', 0))
        # Create PDF with name at specified position
        return create_personalized_pdf(
            template_path, name, out_path,
            x=pdf_x, y=pdf_y,
            page=page,
            fontsize=fontsize,
            color=color
        )
    
    # Image template handling
    try:
        img = Image.open(template_path).convert('RGB')
        draw = ImageDraw.Draw(img)
        font_path = ensure_gujarati_font()
        name_font = None
        if font_path:
            try:
                name_font = ImageFont.truetype(font_path, fontsize)
            except Exception:
                name_font = None
        if name_font is None:
            try:
                name_font = ImageFont.truetype("arial.ttf", fontsize)
            except Exception:
                name_font = ImageFont.load_default()
                
        x = float(pos.get('x', img.width / 2))
        y = float(pos.get('y', img.height / 3))
        
        # Draw name centered
        draw.text((x, y), f"{name}", font=name_font, fill=color, anchor="mm", stroke_width=2, stroke_fill=(255, 255, 255))
        
        # Save
        out_dir = os.path.dirname(out_path)
        if out_dir and not os.path.exists(out_dir):
            os.makedirs(out_dir, exist_ok=True)
            
        img.save(out_path, quality=95)
        print(f"Created invitation for {name} -> {out_path}")
        
    except Exception as e:
        raise Exception(f"Failed to create invitation for {name}: {e}")


def create_personalized_pdf(template_pdf: str, name: str, out_path: str, x: float, y: float, page: int = 0, fontsize: int = 36, fontname: str = "helv", color=(255, 140, 0)):
    """
    Create a personalized PDF by placing `name` at coordinates (x, y) on `page`
    of `template_pdf` and saving it to `out_path`.

    - `page` is 0-based (page 0 = first page). The `select_name_position.py` tool
      saves coordinates in PDF points and also records the page index; pass that
      page value here so the name is drawn on the correct page.
    - Coordinates are in PDF points (1/72 inch).
    """
    try:
        import fitz  # PyMuPDF
    except Exception as e:
        raise RuntimeError("PyMuPDF (fitz) is required to create personalized PDFs. Install pymupdf.")

    if not os.path.exists(template_pdf):
        raise FileNotFoundError(f"Template PDF not found: {template_pdf}")

    doc = fitz.open(template_pdf)
    if page < 0 or page >= len(doc):
        raise ValueError(f"Requested page {page} is out of range for {template_pdf} (has {len(doc)} pages)")
    page = doc.load_page(page)

    # Prepare text
    text = f"{name}"

    # Insert text at the given position
    # fitz expects color as floats 0..1, convert if given as 0..255
    r, g, b = color
    if max(r, g, b) > 1:
        color = (r/255.0, g/255.0, b/255.0)

    # Many fonts used by PyMuPDF do not support Gujarati. To reliably render
    # Gujarati names we render the target PDF page to an image, draw the text
    # with PIL using a TTF that supports Gujarati (if present), and rebuild the
    # PDF with the modified page rasterized. This preserves visual alignment
    # and supports complex scripts.
    try:
        import fitz  # PyMuPDF

        # Render the target page to an image at a higher resolution
        mat = fitz.Matrix(2, 2)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        img_bytes = pix.tobytes('png')

        pil_img = Image.open(io.BytesIO(img_bytes)).convert('RGBA')
        draw = ImageDraw.Draw(pil_img)

        # Ensure Gujarati font is available (downloads Noto Sans Gujarati if needed)
        font_path = ensure_gujarati_font()

        scale = 2  # because we rendered at 2x
        pixel_fontsize = max(8, int(fontsize * scale))
        stroke_w = max(1, int(2 * scale))
        pil_font = None
        if font_path:
            try:
                pil_font = ImageFont.truetype(font_path, pixel_fontsize)
            except Exception:
                pil_font = None
        if pil_font is None:
            try:
                pil_font = ImageFont.truetype("arial.ttf", pixel_fontsize)
            except Exception:
                pil_font = ImageFont.load_default()

        # Compute position in pixel coordinates (scale PDF points by render scale)
        px = x * scale
        py = y * scale
        text_str = f"{name}"

        # Measure text and draw background box for readability
        try:
            bbox = draw.textbbox((0, 0), text_str, font=pil_font)
            text_w = bbox[2] - bbox[0]
            text_h = bbox[3] - bbox[1]
        except Exception:
            text_w, text_h = draw.textsize(text_str, font=pil_font)

        box_margin = int(8 * scale)
        box_coords = [px - text_w/2 - box_margin, py - text_h/2 - box_margin,
                      px + text_w/2 + box_margin, py + text_h/2 + box_margin]
        # NOTE: removed the semi-opaque white rectangle behind the text to avoid
        # drawing a white background. This keeps the template's original look.
        # If readability is still an issue on some templates, we can replace
        # this with a dark semi-opaque box or increase stroke/font size.

        # Draw text centered with a subtle stroke for contrast
        text_color = (220, 14, 14)
        if isinstance(color, (list, tuple)) and len(color) >= 3:
            text_color = tuple(int(c * 255 if isinstance(c, float) and c <= 1.0 else c) for c in color[:3])
            
        try:
            draw.text((px - text_w/2, py - text_h/2), text_str, font=pil_font, fill=text_color, stroke_width=stroke_w, stroke_fill=(255,255,255))
        except TypeError:
            # Older Pillow may not support stroke parameters; fall back
            draw.text((px - text_w/2, py - text_h/2), text_str, font=pil_font, fill=text_color)

        # Convert back to PNG bytes
        out_buf = io.BytesIO()
        pil_img.save(out_buf, format='PNG')
        out_bytes = out_buf.getvalue()

        # Build a new PDF copying all pages but replacing the target page with the image
        new_doc = fitz.open()
        for i in range(len(doc)):
            if i == page.number:
                # create a new page with original size in points
                r = doc[i].rect
                new_page = new_doc.new_page(width=r.width, height=r.height)
                new_page.insert_image(new_page.rect, stream=out_bytes)
            else:
                new_doc.insert_pdf(doc, from_page=i, to_page=i)

        new_doc.save(out_path)
        new_doc.close()
        doc.close()
        print(f"Created personalized PDF for {name} -> {out_path}")
        return
    except Exception as e_img:
        # Fall back to simple vector text insertion if anything fails
        try:
            page.insert_text((x, y), text, fontsize=fontsize, fontname=fontname, fill=color)
        except Exception:
            raise RuntimeError(f"Failed to create personalized PDF: {e_img}")

    # Save to output (preserve other pages)
    out_dir = os.path.dirname(out_path)
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)

    doc.save(out_path)
    doc.close()
    print(f"Created personalized PDF for {name} -> {out_path}")


def get_template_info(template_path: str = "template.pdf") -> dict:
    """Get metadata about the current template (page count, dimensions, etc.)."""
    if not os.path.exists(template_path):
        if os.path.exists("Invitation From Kambaliya Family.pdf"):
            template_path = "Invitation From Kambaliya Family.pdf"
        elif os.path.exists("invitation2.jpeg"):
            template_path = "invitation2.jpeg"
        else:
            return {"exists": False}

    is_pdf = template_path.lower().endswith(".pdf")
    if is_pdf:
        try:
            import fitz
            doc = fitz.open(template_path)
            num_pages = len(doc)
            page0 = doc[0]
            rect = page0.rect
            doc.close()
            return {
                "exists": True,
                "type": "pdf",
                "path": template_path,
                "num_pages": num_pages,
                "width": rect.width,
                "height": rect.height,
                "render_scale": 2.0
            }
        except Exception as e:
            return {"exists": False, "error": str(e)}
    else:
        try:
            with Image.open(template_path) as img:
                return {
                    "exists": True,
                    "type": "image",
                    "path": template_path,
                    "num_pages": 1,
                    "width": img.width,
                    "height": img.height,
                    "render_scale": 1.0
                }
        except Exception as e:
            return {"exists": False, "error": str(e)}


def render_template_page_bytes(template_path: str, page_num: int = 0, scale: float = 2.0):
    """Render a specific page of a PDF or image template to PNG bytes."""
    if not os.path.exists(template_path):
        raise FileNotFoundError(f"Template file '{template_path}' not found.")

    is_pdf = template_path.lower().endswith(".pdf")
    if is_pdf:
        import fitz
        doc = fitz.open(template_path)
        if page_num < 0 or page_num >= len(doc):
            page_num = 0
        page = doc[page_num]
        mat = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        img_bytes = pix.tobytes("png")
        width, height = pix.width, pix.height
        total_pages = len(doc)
        doc.close()
        return img_bytes, width, height, total_pages
    else:
        img = Image.open(template_path).convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue(), img.width, img.height, 1


def render_preview_bytes(template_path: str, name: str, pos_config: dict):
    """Render a single page PNG with the sample name positioned according to pos_config."""
    scale = 2.0
    page_num = int(pos_config.get("page", 0))
    img_bytes, width, height, total_pages = render_template_page_bytes(template_path, page_num, scale)

    pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
    draw = ImageDraw.Draw(pil_img)

    font_path = ensure_gujarati_font()
    raw_fontsize = int(pos_config.get("fontsize", 36))
    pixel_fontsize = max(10, int(raw_fontsize * (scale if template_path.lower().endswith(".pdf") else 1.0)))
    stroke_w = max(1, int(2 * scale)) if template_path.lower().endswith(".pdf") else 2

    pil_font = None
    if font_path:
        try:
            pil_font = ImageFont.truetype(font_path, pixel_fontsize)
        except Exception:
            pil_font = None
    if pil_font is None:
        try:
            pil_font = ImageFont.truetype("arial.ttf", pixel_fontsize)
        except Exception:
            pil_font = ImageFont.load_default()

    # Determine px, py
    if template_path.lower().endswith(".pdf"):
        if "pdf_x" in pos_config and pos_config["pdf_x"] is not None:
            px = float(pos_config["pdf_x"]) * scale
            py = float(pos_config["pdf_y"]) * scale
        else:
            px = float(pos_config.get("x", width / 2))
            py = float(pos_config.get("y", height / 3))
    else:
        px = float(pos_config.get("x", width / 2))
        py = float(pos_config.get("y", height / 3))

    text_str = f"{name}"
    try:
        bbox = draw.textbbox((0, 0), text_str, font=pil_font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
    except Exception:
        text_w, text_h = draw.textsize(text_str, font=pil_font)

    raw_color = pos_config.get("color", [220, 14, 14])
    if isinstance(raw_color, (list, tuple)) and len(raw_color) >= 3:
        fill_color = tuple(int(c * 255 if isinstance(c, float) and c <= 1.0 else c) for c in raw_color[:3])
    else:
        fill_color = (220, 14, 14)

    draw.text((px - text_w / 2, py - text_h / 2), text_str, font=pil_font, fill=fill_color, stroke_width=stroke_w, stroke_fill=(255, 255, 255))

    out_buf = io.BytesIO()
    pil_img.convert("RGB").save(out_buf, format="PNG")
    return out_buf.getvalue()
