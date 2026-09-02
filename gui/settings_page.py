import os
import sys
import customtkinter as ctk
from settings_manager import load_settings, save_settings
from tkinter import messagebox


class SettingsPage(ctk.CTkFrame):

    def __init__(self, master):
        super().__init__(master)
        self.app = master.winfo_toplevel()
        self.process_busy = False
        self.cpu_threads = os.cpu_count() or 1
        self.ram_gb = self._detect_ram_gb()

        title = ctk.CTkLabel(self, text="Settings", font=("Segoe UI", 28, "bold"))
        title.pack(pady=(25, 20))

        perf_frame = ctk.CTkFrame(self)
        perf_frame.pack(padx=20, pady=10, fill="x")

        ctk.CTkLabel(
            perf_frame, text="Search Settings", font=("Segoe UI", 20, "bold")
        ).pack(anchor="w", padx=20, pady=(15, 10))

        ctk.CTkLabel(
            perf_frame, text="CPU Threads", font=("Segoe UI", 15, "bold")
        ).pack(anchor="w", padx=20)

        self.thread_option = ctk.CTkOptionMenu(
            perf_frame,
            values=["Auto (Recommended)", "8", "12", "16", "20", "24", "Custom..."],
            command=self.update_custom_visibility
        )
        self.thread_option.pack(anchor="w", padx=20, pady=(5, 15))
        self.thread_option.set("Auto (Recommended)")

        self.current_setting = ctk.CTkLabel(
            perf_frame, text="Current setting:", font=("Segoe UI", 13)
        )
        self.current_setting.pack(anchor="w", padx=20, pady=(0, 10))

        ctk.CTkLabel(
            perf_frame,
            text=f"Detected CPU: {self.cpu_threads} logical threads"
        ).pack(anchor="w", padx=20)

        self.auto_info_label = ctk.CTkLabel(
            perf_frame, text="Automatically leaves 4 CPU threads free."
        )
        self.auto_help_label = ctk.CTkLabel(
            perf_frame,
            text="Use a lower thread count if you want to work on your computer during processing.",
            wraplength=520, justify="left"
        )

        self.custom_label = ctk.CTkLabel(
            perf_frame, text="Custom thread count", font=("Segoe UI", 15, "bold")
        )
        self.custom_threads = ctk.CTkEntry(
            perf_frame, placeholder_text="Enter thread count..."
        )
        self.custom_limit_label = ctk.CTkLabel(perf_frame, text="")
        self.custom_help_label = ctk.CTkLabel(
            perf_frame,
            text="Recommended: leave 4 logical CPU threads free.",
            wraplength=520, justify="left"
        )


        # Creator Settings
        creator_frame = ctk.CTkFrame(self)
        creator_frame.pack(padx=20, pady=10, fill="x")

        ctk.CTkLabel(
            creator_frame, text="Creator Settings",
            font=("Segoe UI", 20, "bold")
        ).pack(anchor="w", padx=20, pady=(15, 10))

        ctk.CTkLabel(
            creator_frame, text="CPU Threads",
            font=("Segoe UI", 15, "bold")
        ).pack(anchor="w", padx=20)

        self.creator_thread_option = ctk.CTkOptionMenu(
            creator_frame,
            values=["Auto (Recommended)", "8", "12", "14", "16", "20", "24", "Custom..."],
            command=self.update_creator_custom_visibility
        )
        self.creator_thread_option.pack(anchor="w", padx=20, pady=(5, 10))

        self.creator_current_setting = ctk.CTkLabel(
            creator_frame, text="Current setting:", font=("Segoe UI", 13)
        )
        self.creator_current_setting.pack(anchor="w", padx=20, pady=(0, 10))

        self.creator_auto_info = ctk.CTkLabel(creator_frame, text="")
        self.creator_auto_help = ctk.CTkLabel(
            creator_frame,
            text="Auto uses CPU and RAM to select a conservative maximum recommended value.",
            wraplength=520, justify="left"
        )

        self.creator_custom_label = ctk.CTkLabel(
            creator_frame, text="Custom thread count",
            font=("Segoe UI", 15, "bold")
        )
        self.creator_custom_threads = ctk.CTkEntry(
            creator_frame, placeholder_text="Enter thread count..."
        )
        self.creator_custom_limit = ctk.CTkLabel(creator_frame, text="")
        self.creator_custom_help = ctk.CTkLabel(
            creator_frame, text="", wraplength=520, justify="left"
        )

        self.save_button = ctk.CTkButton(
            self, text="Save Settings", command=self.save_current_settings
        )
        self.save_button.pack(anchor="e", padx=20, pady=(5, 20))

        self.load_current_settings()
        self.update_custom_visibility()


    def _detect_ram_gb(self):
        try:
            import ctypes
            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]
            status = MEMORYSTATUSEX()
            status.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return max(1, int(round(status.ullTotalPhys / (1024 ** 3))))
        except Exception:
            pass
        return 16

    def search_auto_threads(self):
        # Keep GUI calculation identical to werzatsong.js backend.
        cpu_limit = max(2, self.cpu_threads - 8)
        ram_limit = max(2, int(self.ram_gb * 1.375))
        return min(self.cpu_threads, cpu_limit, ram_limit)

    def creator_auto_threads(self):
        # Keep GUI calculation identical to werzatsong.js backend.
        cpu_limit = max(2, self.cpu_threads - 18)
        ram_limit = max(2, int(self.ram_gb * 0.75))
        return min(self.cpu_threads, cpu_limit, ram_limit)

    def update_creator_custom_visibility(self, value=None):
        custom = self.creator_thread_option.get() == "Custom..."
        for widget in (
            self.creator_custom_label,
            self.creator_custom_threads,
            self.creator_custom_limit,
            self.creator_custom_help,
        ):
            widget.pack_forget()
        self.creator_auto_info.pack_forget()
        self.creator_auto_help.pack_forget()

        if custom:
            self.creator_custom_label.pack(anchor="w", padx=20, pady=(5, 5))
            self.creator_custom_threads.pack(anchor="w", padx=20, pady=(0, 8))
            self.creator_custom_limit.configure(
                text=f"Maximum: {self.cpu_threads} logical CPU threads"
            )
            self.creator_custom_limit.pack(anchor="w", padx=20)
            self.creator_custom_help.configure(
                text="Custom works independently from Search."
            )
            self.creator_custom_help.pack(anchor="w", padx=20, pady=(0, 12))
        else:
            effective = self.creator_auto_threads()
            self.creator_auto_info.configure(
                text=f"Auto (Recommended) → {effective} threads "
                     f"(Detected: {self.cpu_threads} CPU threads, {self.ram_gb} GB RAM)"
            )
            self.creator_auto_info.pack(anchor="w", padx=20, pady=(5, 0))
            self.creator_auto_help.pack(anchor="w", padx=20, pady=(0, 12))

    def set_process_busy(self, busy):
        self.process_busy = bool(busy)
        state = "disabled" if self.process_busy else "normal"
        self.thread_option.configure(state=state)
        self.custom_threads.configure(state=state)
        self.creator_thread_option.configure(state=state)
        self.creator_custom_threads.configure(state=state)
        self.save_button.configure(state=state)

    def update_custom_visibility(self, value=None):
        is_custom = self.thread_option.get() == "Custom..."

        if is_custom:
            self.auto_info_label.pack_forget()
            self.auto_help_label.pack_forget()

            self.custom_label.pack(anchor="w", padx=20, pady=(10, 5))
            self.custom_threads.pack(anchor="w", padx=20, pady=(0, 10))
            self.custom_limit_label.configure(
                text=f"Maximum: {self.cpu_threads} logical CPU threads"
            )
            self.custom_limit_label.pack(anchor="w", padx=20)
            self.custom_help_label.pack(
                anchor="w", padx=20, pady=(0, 15)
            )
        else:
            self.custom_label.pack_forget()
            self.custom_threads.pack_forget()
            self.custom_limit_label.pack_forget()
            self.custom_help_label.pack_forget()

            if self.thread_option.get() == "Auto (Recommended)":
                self.auto_info_label.pack(
                    anchor="w", padx=20, pady=(10, 0)
                )
                self.auto_help_label.pack(
                    anchor="w", padx=20, pady=(0, 15)
                )
            else:
                self.auto_info_label.pack_forget()
                self.auto_help_label.pack_forget()

    def load_current_settings(self):
        settings = load_settings()
        threads = settings.get("threads", "auto")
        creator_threads = settings.get("creator_threads", "auto")

        if threads == "auto":
            self.thread_option.set("Auto (Recommended)")
            self.custom_threads.delete(0, "end")
        elif str(threads) in ["8", "12", "16", "20", "24"]:
            self.thread_option.set(str(threads))
            self.custom_threads.delete(0, "end")
        else:
            self.thread_option.set("Custom...")
            self.custom_threads.delete(0, "end")
            self.custom_threads.insert(0, str(threads))

        if threads == "auto":
            effective = self.search_auto_threads()
            self.current_setting.configure(
                text=f"Current setting: Auto (Recommended) → {effective} threads"
            )
        elif str(threads) in ["8", "12", "16", "20", "24"]:
            self.current_setting.configure(text=f"Current setting: {threads} threads")
        else:
            self.current_setting.configure(
                text=f"Current setting: Custom ({threads} threads)"
            )

        self.update_custom_visibility()


        if creator_threads == "auto":
            self.creator_thread_option.set("Auto (Recommended)")
            self.creator_custom_threads.delete(0, "end")
            effective = self.creator_auto_threads()
            self.creator_current_setting.configure(
                text=f"Current setting: Auto (Recommended) → {effective} threads"
            )
        elif str(creator_threads) in ["8", "12", "14", "16", "20", "24"]:
            self.creator_thread_option.set(str(creator_threads))
            self.creator_custom_threads.delete(0, "end")
            self.creator_current_setting.configure(
                text=f"Current setting: {creator_threads} threads"
            )
        else:
            self.creator_thread_option.set("Custom...")
            self.creator_custom_threads.delete(0, "end")
            self.creator_custom_threads.insert(0, str(creator_threads))
            self.creator_current_setting.configure(
                text=f"Current setting: Custom ({creator_threads} threads)"
            )
        self.update_creator_custom_visibility()

    def save_current_settings(self):
        if self.process_busy or self.app.process_busy:
            return

        settings = load_settings()
        value = self.thread_option.get()
        creator_value = self.creator_thread_option.get()

        if value == "Auto (Recommended)":
            settings["threads"] = "auto"
        elif value == "Custom...":
            try:
                custom_value = int(self.custom_threads.get())
            except ValueError:
                messagebox.showerror(
                    "Invalid Thread Count",
                    "Please enter a whole number of CPU threads."
                )
                return

            if custom_value < 4:
                messagebox.showerror(
                    "Invalid Thread Count",
                    "Custom thread count must be at least 4."
                )
                return

            if custom_value > self.cpu_threads:
                messagebox.showerror(
                    "Invalid Thread Count",
                    f"This computer has {self.cpu_threads} logical CPU threads.\n"
                    f"Custom thread count cannot exceed {self.cpu_threads}."
                )
                return

            settings["threads"] = custom_value
        else:
            settings["threads"] = int(value)

        if creator_value == "Auto (Recommended)":
            settings["creator_threads"] = "auto"
        elif creator_value == "Custom...":
            try:
                creator_custom = int(self.creator_custom_threads.get())
            except ValueError:
                messagebox.showerror(
                    "Invalid Creator Thread Count",
                    "Please enter a whole number of Creator threads."
                )
                return
            if creator_custom < 4 or creator_custom > self.cpu_threads:
                messagebox.showerror(
                    "Invalid Creator Thread Count",
                    f"Creator custom value must be between 4 and {self.cpu_threads}."
                )
                return
            settings["creator_threads"] = creator_custom
        else:
            settings["creator_threads"] = int(creator_value)

        save_settings(settings)
        self.load_current_settings()

        if messagebox.askyesno(
            "Restart Required",
            "Settings saved successfully.\n\nRestart WerZatSong now to apply the changes?"
        ):
            self.restart_program()

    def restart_program(self):
        os.execl(sys.executable, sys.executable, *sys.argv)
