import customtkinter as ctk
import sys
from pathlib import Path

from gui.search_page import SearchPage
from gui.fingerprint_page import FingerprintPage
from gui.settings_page import SettingsPage

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")


class WerZatSongApp(ctk.CTk):

    def __init__(self):
        super().__init__()

        self.title("WerZatSong 2.0")

        if getattr(sys, "frozen", False):
            icon_path = Path(sys.executable).resolve().parent / "WerZatSong.ico"
            if icon_path.exists():
                try:
                    self.iconbitmap(str(icon_path))
                except Exception:
                    pass

        self.geometry("1350x850")
        self.minsize(1200, 750)

        # ==========================================
        # SIDEBAR
        # ==========================================

        self.sidebar = ctk.CTkFrame(
            self,
            width=220,
            corner_radius=0
        )

        self.sidebar.pack(
            side="left",
            fill="y"
        )

        self.logo = ctk.CTkLabel(
            self.sidebar,
            text="WerZatSong",
            font=("Segoe UI", 28, "bold")
        )

        self.logo.pack(
            pady=(30, 40)
        )

        self.btn_search = ctk.CTkButton(
            self.sidebar,
            text="Search",
            height=40,
            command=lambda: self.show_page("search")
        )

        self.btn_search.pack(
            fill="x",
            padx=15,
            pady=8
        )

        self.btn_fp = ctk.CTkButton(
            self.sidebar,
            text="Fingerprint Creator",
            height=40,
            command=lambda: self.show_page("fingerprint")
        )

        self.btn_fp.pack(
            fill="x",
            padx=15,
            pady=8
        )

        self.btn_settings = ctk.CTkButton(
            self.sidebar,
            text="Settings",
            height=40,
            command=lambda: self.show_page("settings")
        )

        self.btn_settings.pack(
            fill="x",
            padx=15,
            pady=8
        )

        # spacer

        ctk.CTkLabel(
            self.sidebar,
            text=""
        ).pack(
            expand=True
        )

        self.version = ctk.CTkLabel(
            self.sidebar,
            text="Version 2.0"
        )

        self.version.pack(
            pady=(0, 20)
        )

        # ==========================================
        # MAIN
        # ==========================================

        self.main = ctk.CTkFrame(
            self,
            corner_radius=0
        )

        self.main.pack(
            side="left",
            fill="both",
            expand=True
        )

        self.page = ctk.CTkFrame(
            self.main,
            fg_color="transparent"
        )

        self.page.pack(
            fill="both",
            expand=True
        )

        # ==========================================
        # STATUS BAR
        # ==========================================

        self.status = ctk.CTkLabel(
            self,
            text="Ready",
            anchor="w"
        )

        self.status.pack(
            side="bottom",
            fill="x",
            padx=15,
            pady=8
        )

        # Keep all pages alive so running jobs keep their logs/progress.
        self.process_busy = False
        self.process_type = None

        self.search_page = SearchPage(self.page)
        self.fingerprint_page = FingerprintPage(self.page)
        self.settings_page = SettingsPage(self.page)

        self.pages = {
            "search": self.search_page,
            "fingerprint": self.fingerprint_page,
            "settings": self.settings_page,
        }

        self.show_page("search")

    def set_process_busy(self, busy, process_type=None):
        self.process_busy = bool(busy)
        self.process_type = process_type if busy else None

        # Disable navigation for the whole application while a job runs.
        state = "disabled" if self.process_busy else "normal"
        self.btn_search.configure(state=state)
        self.btn_fp.configure(state=state)
        self.btn_settings.configure(state=state)

        # Only pages that actually implement the shared lock are called.
        self.search_page.set_process_busy(self.process_busy)
        self.fingerprint_page.set_process_busy(self.process_busy)

    def show_page(self, page):
        if self.process_busy:
            return
        for frame in self.pages.values():
            frame.pack_forget()
        self.pages[page].pack(fill="both", expand=True)
        if page == "search":
            self.status.configure(text="Search page loaded.")
        elif page == "fingerprint":
            self.status.configure(text="Fingerprint Creator loaded.")
        elif page == "settings":
            self.status.configure(text="Settings loaded.")


if __name__ == "__main__":

    app = WerZatSongApp()
    app.mainloop()