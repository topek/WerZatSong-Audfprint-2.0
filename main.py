import os
import ctypes
from gui.app import WerZatSongApp


def disable_console_input():
    if os.name != "nt":
        return
    try:
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.GetStdHandle(-10)  # STD_INPUT_HANDLE
        mode = ctypes.c_uint()
        if kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
            # Disable line input and keyboard echo.
            mode.value &= ~(0x0002 | 0x0004)
            kernel32.SetConsoleMode(handle, mode)
    except Exception:
        pass


disable_console_input()

app = WerZatSongApp()
app.mainloop()
