import customtkinter as ctk
import subprocess
import threading
import sys
import os
from pathlib import Path


class SearchPage(ctk.CTkFrame):

    def __init__(self, master):
        super().__init__(master)

        if getattr(sys, "frozen", False):
            self.root_dir = Path(sys.executable).resolve().parent
        else:
            self.root_dir = Path(__file__).resolve().parent.parent
        self.process = None

        self.grid_columnconfigure(0, weight=1)
        self.grid_columnconfigure(1, weight=1)

        self.grid_rowconfigure(0, weight=0)
        self.grid_rowconfigure(1, weight=0)
        self.grid_rowconfigure(2, weight=1)

        title = ctk.CTkLabel(
            self,
            text="Search",
            font=("Segoe UI", 28, "bold")
        )

        title.grid(
            row=0,
            column=0,
            columnspan=2,
            sticky="w",
            padx=20,
            pady=(20, 15)
        )

        # =====================================================
        # LEFT PANEL
        # =====================================================

        left = ctk.CTkFrame(self)

        left.grid(
            row=1,
            column=0,
            sticky="nsew",
            padx=(20, 10),
            pady=10
        )

        ctk.CTkLabel(
            left,
            text="Search",
            font=("Segoe UI", 18, "bold")
        ).pack(anchor="w", padx=20, pady=(20, 15))

        ctk.CTkLabel(
            left,
            text="Input Folder",
            font=("Segoe UI", 16, "bold")
        ).pack(anchor="w", padx=20, pady=(0, 5))

        ctk.CTkLabel(
            left,
            text="Place all audio files into the 'input' folder.\nPress SEARCH to start WerZatSong.",
            justify="left"
        ).pack(anchor="w", padx=20, pady=(0, 20))

        # =====================================================
        # DATABASE
        # =====================================================

        ctk.CTkLabel(
            left,
            text="Database Selection",
            font=("Segoe UI", 16, "bold")
        ).pack(anchor="w", padx=20, pady=(0, 5))

        self.database_mode = ctk.StringVar(value="all")

        ctk.CTkRadioButton(
            left,
            text="All Databases",
            variable=self.database_mode,
            value="all",
            command=self.update_database_state
        ).pack(anchor="w", padx=20)

        ctk.CTkRadioButton(
            left,
            text="Custom Selection",
            variable=self.database_mode,
            value="custom",
            command=self.update_database_state
        ).pack(anchor="w", padx=20, pady=(0, 10))

        self.database_frame = ctk.CTkScrollableFrame(
            left,
            height=180
        )

        self.database_frame.pack(fill="x", padx=20, pady=(0, 10))

        buttons_frame = ctk.CTkFrame(left, fg_color="transparent")
        buttons_frame.pack(fill="x", padx=20, pady=(0, 10))

        self.select_all_button = ctk.CTkButton(
            buttons_frame,
            text="Select All",
            width=120,
            command=self.select_all_databases
        )
        self.select_all_button.pack(side="left")

        self.deselect_all_button = ctk.CTkButton(
            buttons_frame,
            text="Deselect All",
            width=120,
            command=self.deselect_all_databases
        )
        self.deselect_all_button.pack(side="right")

        self.database_checkboxes = []

        database_dir = self.root_dir / "database"

        if database_dir.exists():

            for folder in sorted(database_dir.iterdir()):

                if folder.is_dir():

                    var = ctk.BooleanVar(value=True)

                    cb = ctk.CTkCheckBox(
                        self.database_frame,
                        text=f"📁 {folder.name}",
                        variable=var
                    )

                    cb.pack(anchor="w", pady=2)

                    self.database_checkboxes.append(
                        (cb, var, folder.name, "folder")
                    )

            for file in sorted(database_dir.glob("*.pklz")):

                var = ctk.BooleanVar(value=True)

                cb = ctk.CTkCheckBox(
                    self.database_frame,
                    text=f"📄 {file.name}",
                    variable=var
                )

                cb.pack(anchor="w", pady=2)

                self.database_checkboxes.append(
                    (cb, var, file.name, "file")
                )

        self.update_database_state()

        search_buttons = ctk.CTkFrame(left, fg_color="transparent")
        search_buttons.pack(fill="x", padx=20, pady=(0, 20))

        self.search_button = ctk.CTkButton(
            search_buttons,
            text="SEARCH",
            height=42,
            command=self.start_search
        )
        self.search_button.pack(side="left", expand=True, fill="x", padx=(0,5))

        self.stop_button = ctk.CTkButton(
            search_buttons,
            text="STOP",
            height=42,
            command=self.stop_search,
            state="disabled"
        )
        self.stop_button.pack(side="left", expand=True, fill="x", padx=(5,0))

        self.progress = ctk.CTkProgressBar(left)

        self.progress.pack(fill="x", padx=20, pady=(0, 20))

        self.progress.set(0)

        # =====================================================
        # RIGHT PANEL
        # =====================================================

        right = ctk.CTkScrollableFrame(self)

        right.grid(
            row=1,
            column=1,
            sticky="nsew",
            padx=(10, 20),
            pady=10
        )

        ctk.CTkLabel(
            right,
            text="Search Options",
            font=("Segoe UI", 18, "bold")
        ).pack(anchor="w", padx=20, pady=(20, 5))

        ctk.CTkLabel(
            right,
            text="By default, WerZatSong analyzes the full audio file.",
            justify="left"
        ).pack(anchor="w", padx=20, pady=(0, 15))

        self.enable_speed = ctk.BooleanVar(value=False)

        self.enable_speed_checkbox = ctk.CTkCheckBox(
            right,
            text="Enable Speed Correction",
            variable=self.enable_speed,
            command=self.update_speed_controls
        )
        self.enable_speed_checkbox.pack(anchor="w", padx=20, pady=(0, 10))

        self.speed_mode = ctk.StringVar(value="single")

        self.speed_single = ctk.CTkRadioButton(
            right,
            text="Single",
            variable=self.speed_mode,
            value="single",
            command=self.update_speed_mode
        )
        self.speed_single.pack(anchor="w", padx=20)

        self.speed_multi = ctk.CTkRadioButton(
            right,
            text="Multi",
            variable=self.speed_mode,
            value="multi",
            command=self.update_speed_mode
        )
        self.speed_multi.pack(anchor="w", padx=20, pady=(0, 15))

        ctk.CTkLabel(
            right,
            text="Trim Mode",
            font=("Segoe UI", 16, "bold")
        ).pack(anchor="w", padx=20, pady=(0, 5))

        self.trim_first = ctk.BooleanVar(value=False)
        self.trim_middle = ctk.BooleanVar(value=False)

        self.trim_first_checkbox = ctk.CTkCheckBox(
            right,
            text="Trim First 75 Seconds",
            variable=self.trim_first
        )
        self.trim_first_checkbox.pack(anchor="w", padx=20)

        ctk.CTkLabel(
            right,
            text="Cuts the audio to the first 75 seconds.",
            justify="left",
            anchor="w",
            wraplength=430
        ).pack(anchor="w", padx=40, pady=(0, 8))

        self.trim_middle_checkbox = ctk.CTkCheckBox(
            right,
            text="Trim Middle 45 Seconds",
            variable=self.trim_middle
        )
        self.trim_middle_checkbox.pack(anchor="w", padx=20)

        ctk.CTkLabel(
            right,
            text="Cuts the audio to the middle 45 seconds.\n\n(You can select both options.)",
            justify="left",
            anchor="w",
            wraplength=430
        ).pack(anchor="w", padx=40, pady=(0, 15))

        ctk.CTkLabel(
            right,
            text="Speeds",
            font=("Segoe UI", 16, "bold")
        ).pack(anchor="w", padx=20, pady=(0, 5))

        self.speed_enabled1 = ctk.BooleanVar(value=True)
        self.speed_enabled2 = ctk.BooleanVar(value=False)
        self.speed_enabled3 = ctk.BooleanVar(value=False)
        self.speed_enabled4 = ctk.BooleanVar(value=False)
        self.speed_enabled5 = ctk.BooleanVar(value=False)

        self.speed1_frame = ctk.CTkFrame(right, fg_color="transparent")
        self.speed2_frame = ctk.CTkFrame(right, fg_color="transparent")
        self.speed3_frame = ctk.CTkFrame(right, fg_color="transparent")
        self.speed4_frame = ctk.CTkFrame(right, fg_color="transparent")
        self.speed5_frame = ctk.CTkFrame(right, fg_color="transparent")

        self.create_speed_slider(self.speed1_frame, "Speed #1")
        self.create_speed_slider(self.speed2_frame, "Speed #2")
        self.create_speed_slider(self.speed3_frame, "Speed #3")
        self.create_speed_slider(self.speed4_frame, "Speed #4")
        self.create_speed_slider(self.speed5_frame, "Speed #5")

        self.speed1_frame.pack(fill="x", padx=20)

        # =====================================================
        # CONSOLE
        # =====================================================

        console = ctk.CTkFrame(self)

        console.grid(
            row=2,
            column=0,
            columnspan=2,
            sticky="nsew",
            padx=20,
            pady=(0, 20)
        )

        ctk.CTkLabel(
            console,
            text="Console",
            font=("Segoe UI", 18, "bold")
        ).pack(anchor="w", padx=20, pady=(20, 10))

        self.log = ctk.CTkTextbox(console, height=260)

        self.log._textbox.tag_configure("green", foreground="#00ff00")
        self.log._textbox.tag_configure("orange", foreground="#ff9900")
        self.log._textbox.tag_configure("red", foreground="#ff4444")
        self.log._textbox.tag_configure("cyan", foreground="#00d8ff")
        self.log._textbox.tag_configure("header", foreground="white", font=("Segoe UI", 11, "bold"))

        self.log.pack(
            fill="both",
            expand=True,
            padx=20,
            pady=(0, 20)
        )

        self.update_speed_controls()

    def set_process_busy(self, busy):
        """Lock Search controls while another application operation runs."""
        busy = bool(busy)

        # Main action buttons.
        self.search_button.configure(state="disabled" if busy else "normal")
        # STOP must become available immediately when a search starts.
        # The subprocess is created in the worker thread, so self.process
        # can still be None at the exact moment the global busy state is set.
        self.stop_button.configure(
            state="normal" if busy else "disabled"
        )

        # Database selection controls.
        db_state = "disabled" if busy else "normal"
        for cb, _, _, _ in self.database_checkboxes:
            cb.configure(state=db_state)

        self.select_all_button.configure(state=db_state)
        self.deselect_all_button.configure(state=db_state)

        # Search options.
        option_widgets = [
            self.enable_speed_checkbox,
            self.trim_first_checkbox,
            self.trim_middle_checkbox,
            self.speed_single,
            self.speed_multi,
        ]

        for widget in option_widgets:
            widget.configure(state=db_state)

        for name in (
            "speed_checkbox1", "speed_checkbox2", "speed_checkbox3",
            "speed_checkbox4", "speed_checkbox5"
        ):
            widget = getattr(self, name, None)
            if widget is not None:
                widget.configure(state=db_state)

        for name in (
            "speed_slider", "speed_slider2", "speed_slider3",
            "speed_slider4", "speed_slider5"
        ):
            widget = getattr(self, name, None)
            if widget is not None:
                widget.configure(state=db_state)

    def create_speed_slider(self, parent, title):

        if title.endswith("1"):
            var=self.speed_enabled1
        elif title.endswith("2"):
            var=self.speed_enabled2
        elif title.endswith("3"):
            var=self.speed_enabled3
        elif title.endswith("4"):
            var=self.speed_enabled4
        else:
            var=self.speed_enabled5

        checkbox = ctk.CTkCheckBox(
            parent,
            text=title,
            variable=var,
            command=self.update_speed_controls
        )
        checkbox.pack(anchor="w")
        if title.endswith("1"):
            self.speed_checkbox1=checkbox
        elif title.endswith("2"):
            self.speed_checkbox2=checkbox
        elif title.endswith("3"):
            self.speed_checkbox3=checkbox
        elif title.endswith("4"):
            self.speed_checkbox4=checkbox
        else:
            self.speed_checkbox5=checkbox

        slider = ctk.CTkSlider(
            parent,
            from_=-10,
            to=10,
            number_of_steps=40
        )

        slider.pack(fill="x", pady=(5, 0))
        slider.set(0)

        scale = ctk.CTkFrame(parent, fg_color="transparent")
        scale.pack(fill="x")

        ctk.CTkLabel(scale, text="-10").pack(side="left")
        ctk.CTkLabel(scale, text="0").pack(side="left", expand=True)
        ctk.CTkLabel(scale, text="+10").pack(side="right")

        entry = ctk.CTkEntry(parent, width=80)
        entry.pack(anchor="w", pady=(5, 15))
        entry.insert(0, "0.0")

        slider.configure(
            command=lambda value, e=entry: self.update_speed_entry(e, value)
        )

        if title.endswith("1"):
            self.speed_slider = slider
            self.speed_value = entry
        elif title.endswith("2"):
            self.speed_slider2 = slider
            self.speed_value2 = entry
        elif title.endswith("3"):
            self.speed_slider3 = slider
            self.speed_value3 = entry
        elif title.endswith("4"):
            self.speed_slider4 = slider
            self.speed_value4 = entry
        else:
            self.speed_slider5 = slider
            self.speed_value5 = entry

    def update_speed_entry(self, entry, value):

        entry.delete(0, "end")
        entry.insert(0, f"{value:.1f}")

    def update_speed_mode(self):

        self.speed2_frame.pack_forget()
        self.speed3_frame.pack_forget()
        self.speed4_frame.pack_forget()
        self.speed5_frame.pack_forget()

        if self.speed_mode.get() == "single":

            # Single mode always uses Speed #1.
            self.speed_enabled1.set(True)

            self.speed_checkbox1.configure(state="disabled")
            self.speed_checkbox2.configure(state="disabled")
            self.speed_checkbox3.configure(state="disabled")
            self.speed_checkbox4.configure(state="disabled")
            self.speed_checkbox5.configure(state="disabled")

        else:

            # Multi mode: all checkboxes are available when
            # Speed Correction is enabled.
            checkbox_state = "normal" if self.enable_speed.get() else "disabled"

            self.speed_checkbox1.configure(state=checkbox_state)
            self.speed_checkbox2.configure(state=checkbox_state)
            self.speed_checkbox3.configure(state=checkbox_state)
            self.speed_checkbox4.configure(state=checkbox_state)
            self.speed_checkbox5.configure(state=checkbox_state)

            self.speed2_frame.pack(fill="x", padx=20)
            self.speed3_frame.pack(fill="x", padx=20)
            self.speed4_frame.pack(fill="x", padx=20)
            self.speed5_frame.pack(fill="x", padx=20)

        if self.enable_speed.get():

            if self.speed_mode.get() == "single":

                self.speed_single.configure(
                    border_color=("#1F6AA5", "#144870"),
                    fg_color=("#1F6AA5", "#144870")
                )

                self.speed_multi.configure(
                    border_color=("gray55", "gray35"),
                    fg_color=("gray55", "gray35")
                )

            else:

                self.speed_multi.configure(
                    border_color=("#1F6AA5", "#144870"),
                    fg_color=("#1F6AA5", "#144870")
                )

                self.speed_single.configure(
                    border_color=("gray55", "gray35"),
                    fg_color=("gray55", "gray35")
                )

        self.update_individual_speed_controls()


    def update_individual_speed_controls(self):

        enabled_color = ("#1F6AA5", "#144870")
        disabled_color = ("gray55", "gray35")

        controls = [
            (self.speed_enabled1, self.speed_slider, self.speed_value),
            (self.speed_enabled2, self.speed_slider2, self.speed_value2),
            (self.speed_enabled3, self.speed_slider3, self.speed_value3),
            (self.speed_enabled4, self.speed_slider4, self.speed_value4),
            (self.speed_enabled5, self.speed_slider5, self.speed_value5),
        ]

        for enabled_var, slider, entry in controls:

            if not self.enable_speed.get():
                state = "disabled"
                color = disabled_color

            elif self.speed_mode.get() == "single":
                state = "normal"
                color = enabled_color

            elif enabled_var.get():
                state = "normal"
                color = enabled_color

            else:
                state = "disabled"
                color = disabled_color

            slider.configure(
                state=state,
                button_color=color,
                button_hover_color=color
            )

            entry.configure(state=state)


    def update_speed_controls(self):

        enabled = self.enable_speed.get()
        state = "normal" if enabled else "disabled"

        if enabled:
            radio_border = ("#1F6AA5", "#1F6AA5")
        else:
            radio_border = ("gray55", "gray35")

        self.speed_single.configure(
            state=state,
            border_color=radio_border,
            fg_color=radio_border
        )
        self.speed_multi.configure(
            state=state,
            border_color=radio_border,
            fg_color=radio_border
        )

        self.update_speed_mode()

    def update_database_state(self):

        enabled = self.database_mode.get() == "custom"
        state = "normal" if enabled else "disabled"

        for checkbox, _, _, _ in self.database_checkboxes:
            checkbox.configure(state=state)

        self.select_all_button.configure(state=state)
        self.deselect_all_button.configure(state=state)

    def select_all_databases(self):

        for _, var, _, _ in self.database_checkboxes:
            var.set(True)

    def deselect_all_databases(self):

        for _, var, _, _ in self.database_checkboxes:
            var.set(False)

    def write_log(self, text):

        # Keep the backend output intact, but remove Windows replacement
        # characters that can appear when a console encoding is involved.
        text = text.replace("\ufffd", "")

        if "🟢 SUCCESS" in text or "SUCCESS" in text:
            self.log._textbox.insert("end", text, ("green",))
        elif "🟠 POSSIBLE" in text or "POSSIBLE" in text:
            self.log._textbox.insert("end", text, ("orange",))
        elif "🟡 WEAK" in text or "WEAK" in text:
            self.log._textbox.insert("end", text, ("orange",))
        elif "LOW (may still be correct)" in text:
            self.log._textbox.insert("end", text, ("orange",))
        elif "[ERROR]" in text or "ERROR:" in text:
            self.log._textbox.insert("end", text, ("red",))
        elif text.startswith("[INFO]: 🎵") or "🎵" in text:
            self.log._textbox.insert("end", text, ("header",))
        elif "[INFO]" in text:
            self.log._textbox.insert("end", text, ("cyan",))
        else:
            self.log._textbox.insert("end", text)

        self.log.see("end")
        self.update_idletasks()

    def start_search(self):

        self.log.delete("1.0", "end")
        self.progress.set(0)
        self.winfo_toplevel().set_process_busy(True, "search")

        threading.Thread(
            target=self.run_search,
            daemon=True
        ).start()


    def stop_search(self):

        if self.process is not None:
            try:
                if self.process.poll() is None:
                    self.process.terminate()
            except Exception:
                pass

        self.write_log("\nSearch stopped by user.\n")
        self.winfo_toplevel().set_process_busy(False)

    def run_search(self):

        try:

            node_exe = self.root_dir / "runtime" / "node" / "node.exe"
            script_path = self.root_dir / "werzatsong.js"

            command = [
                str(node_exe),
                str(script_path),
                "--audfprint"
            ]

            # Hide the black console window when launched from the Windows EXE.
            creationflags = 0
            startupinfo = None

            child_env = os.environ.copy()
            child_env["PYTHONUTF8"] = "1"
            child_env["PYTHONIOENCODING"] = "utf-8"
            if sys.platform == "win32":
                creationflags = subprocess.CREATE_NO_WINDOW
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                startupinfo.wShowWindow = subprocess.SW_HIDE

            if self.database_mode.get() == "custom":

                for _, var, name, _ in self.database_checkboxes:

                    if var.get():
                        command.extend([
                            "--database",
                            name
                        ])

            if self.enable_speed.get():

                if self.speed_mode.get() == "single":

                    command.extend([
                        "--speed",
                        self.speed_value.get()
                    ])

                else:

                    speeds=[]
                    if self.speed_enabled1.get(): speeds.append(self.speed_value.get())
                    if self.speed_enabled2.get(): speeds.append(self.speed_value2.get())
                    if self.speed_enabled3.get(): speeds.append(self.speed_value3.get())
                    if self.speed_enabled4.get(): speeds.append(self.speed_value4.get())
                    if self.speed_enabled5.get(): speeds.append(self.speed_value5.get())
                    if speeds:
                        command.append("--multi-speed=" + ",".join(speeds))

            if self.trim_first.get():
                command.append("--trim-first")

            if self.trim_middle.get():
                command.append("--trim-middle")

            self.write_log("COMMAND:\n")
            self.write_log(" ".join(command) + "\n\n")

            self.process = subprocess.Popen(
                command,
                cwd=self.root_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=creationflags,
                startupinfo=startupinfo,
                env=child_env,
                stdin=subprocess.DEVNULL
            )

            for line in self.process.stdout:
                self.write_log(line)

            self.process.wait()

            if self.process.returncode == 0:
                self.progress.set(1)
                self.write_log("\nFinished.\n")
            else:
                self.write_log(
                    f"\nProcess exited with code {self.process.returncode}\n"
                )

        except Exception as e:

            self.write_log(f"\nERROR:\n{e}\n")

        finally:

            self.process = None
            self.winfo_toplevel().set_process_busy(False)