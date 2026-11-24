import PyInstaller.__main__
import os

if __name__ == '__main__':
    # Determine the directory of the script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    PyInstaller.__main__.run([
        'app.py',
        '--name=INVITO powered by She Systems',
        '--onefile',
        '--noconsole', # Don't show terminal window
        f'--add-data={os.path.join(script_dir, "templates")};templates',
        f'--add-data={os.path.join(script_dir, "static")};static',
        f'--add-data={os.path.join(script_dir, "select_name_position1.py")};.',
        f'--add-data={os.path.join(script_dir, "whatsapp_sender.py")};.',
        f'--add-data={os.path.join(script_dir, "create_invitation.py")};.',
        '--hidden-import=pandas',
        '--hidden-import=selenium',
        '--hidden-import=flask',
        '--hidden-import=openpyxl',
        '--hidden-import=PIL',
        '--hidden-import=webdriver_manager',
        '--hidden-import=fitz',
        '--hidden-import=tkinter',
        '--clean'
    ])
