# INVITO — Bulk WhatsApp Invitation Web Application

A modern, full-featured web application to design, generate, and dispatch personalized WhatsApp wedding & event invitations in bulk from any browser or mobile device.

---

## 🌟 Key Features

1. **In-Browser Interactive Name Position Editor**:
   - Visual HTML5 Canvas editor directly inside your browser.
   - Drag & drop or click anywhere on your PDF/Image invitation template to set the name coordinates.
   - Adjust font size, text color (with wedding color swatches), and Gujarati/English sample text.
   - Keyboard arrow keys for micro-pixel adjustments (Shift + Arrows for 10px).
   - Instant live PDF rendering preview before saving.
   - **No desktop GUI / Tkinter required** — 100% web based.

2. **Contacts Management**:
   - Upload Excel (`.xlsx`, `.xls`) or CSV sheets.
   - Searchable, interactive contacts table with inline editing, adding, and deletion.
   - Automatically cleans and normalizes phone numbers for WhatsApp international format.
   - One-click sample Excel template download.

3. **Message Customization**:
   - Personalized message templates supporting dynamic variables: `{{name}}` and `{{number}}`.
   - Emoji toolbar (🌸, 💐, 🪔, ✨, 🙏, 💍) and full Gujarati Unicode script support.
   - Live interactive WhatsApp chat bubble mockup updating in real time.

4. **Batch Generation & Bulk Download**:
   - Generate high-resolution personalized PDFs for all recipients with progress tracking.
   - Built-in Gallery to preview any generated invitation.
   - **Download All as ZIP** with a single click.

5. **WhatsApp Delivery Suite**:
   - **Interactive Web Queue (Client-Side, No Selenium Needed)**:
     - Direct WhatsApp Web (`https://web.whatsapp.com/send`) and Mobile WhatsApp (`https://api.whatsapp.com/send`) links.
     - **"Send Next in Queue"** quick dispatch flow with auto-sent tracking.
     - Works across mobile phones, tablets, and PCs without server configuration.
   - **Automated Runner (Selenium)**:
     - For local machines, launch automated background browser sending with real-time streaming terminal logs.

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Start the Web Server
```bash
python app.py
```
By default, the server will start at:
```
http://127.0.0.1:5000/
```

### 3. Open on Mobile or Local Wi-Fi
To access the website from your smartphone or other PCs on your local Wi-Fi:
1. Find your host computer's IP address (e.g., `192.168.1.15`).
2. Set the environment variable or run:
   ```bash
   $env:HOST="0.0.0.0"; python app.py
   ```
3. Open `http://192.168.1.15:5000/` on your phone browser.

---

## 📁 File Structure

```
Bulk Invite Sender/
├── app.py                      # Flask backend API & Web Server
├── create_invitation.py        # PDF & Image personalization & rendering engine
├── whatsapp_sender.py          # Selenium automated runner
├── template.pdf                # Base invitation template
├── name_position.json          # Stored name coordinates & typography configuration
├── contacts.xlsx               # Recipient spreadsheet
├── message_template.txt        # Saved message text
├── templates/
│   └── index.html              # Modern Glassmorphism Single-Page Web Suite
├── static/
│   ├── css/style.css           # Responsive stylesheet & animations
│   └── js/main.js              # In-browser Canvas editor & client-side queue
├── invitations/                # Output folder for generated invitation PDFs
└── requirements.txt            # Python dependencies
```

---

## ☁️ Cloud Deployment

INVITO is stateless and cloud-ready. You can deploy it to **Render**, **Railway**, **AWS**, or **DigitalOcean**:
- **Build Command**: `pip install -r requirements.txt`
- **Start Command**: `python app.py` (or `waitress-serve --port=$PORT app:app`)
