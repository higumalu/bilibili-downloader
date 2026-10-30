"""Run the system folder picker separately from native messaging threads."""
import json
from pathlib import Path
import sys
import tkinter as tk
from tkinter import filedialog

root = tk.Tk()
root.withdraw()
root.attributes('-topmost', True)
try:
    initial = Path(sys.argv[1])
    while not initial.is_dir() and initial != initial.parent:
        initial = initial.parent
    selected = filedialog.askdirectory(parent=root, title='選擇影片儲存資料夾' if len(sys.argv) > 2 and sys.argv[2] == 'zh_TW' else 'Choose a video download folder',
                                       initialdir=str(initial), mustexist=True)
    sys.stdout.buffer.write(json.dumps(selected, ensure_ascii=False).encode('utf-8'))
finally:
    root.destroy()
