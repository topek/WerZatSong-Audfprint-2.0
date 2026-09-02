import customtkinter as ctk
from tkinter import filedialog, messagebox
from pathlib import Path
import sys
import os
import subprocess
import threading


class FingerprintPage(ctk.CTkFrame):

    @staticmethod
    def get_app_root():
        if getattr(sys, "frozen", False):
            return Path(sys.executable).resolve().parent
        return Path(__file__).resolve().parent.parent

    def __init__(self, master):
        super().__init__(master)

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(2, weight=1)

        # ==========================
        # TITLE
        # ==========================

        title = ctk.CTkLabel(
            self,
            text="Fingerprint Creator",
            font=("Segoe UI", 28, "bold")
        )

        title.grid(
            row=0,
            column=0,
            sticky="w",
            padx=20,
            pady=(20, 15)
        )

        # ==========================
        # MAIN PANEL
        # ==========================

        panel = ctk.CTkFrame(self)

        panel.grid(
            row=1,
            column=0,
            sticky="nsew",
            padx=20,
            pady=10
        )

        # Source Files / Folders

        ctk.CTkLabel(
            panel,
            text="Source Files / Folders",
            font=("Segoe UI", 18, "bold")
        ).pack(anchor="w", padx=20, pady=(20, 10))

        self.source_paths = []

        import tkinter as tk

        self.source_listbox = tk.Listbox(
            panel,
            selectmode=tk.EXTENDED,
            height=6
        )
        self.source_listbox.pack(fill="x", padx=20)

        source_buttons = ctk.CTkFrame(panel, fg_color="transparent")
        source_buttons.pack(fill="x", padx=20, pady=(10, 20))

        self.btn_add_folder = ctk.CTkButton(
            source_buttons,
            text="ADD FOLDER",
            command=self.add_source_folder
        )
        self.btn_add_folder.pack(side="left", padx=(0, 8))

        self.btn_add_files = ctk.CTkButton(
            source_buttons,
            text="ADD FILES",
            command=self.add_source_files
        )
        self.btn_add_files.pack(side="left", padx=8)

        self.btn_remove_source = ctk.CTkButton(
            source_buttons,
            text="REMOVE SELECTED",
            command=self.remove_selected_sources
        )
        self.btn_remove_source.pack(side="left", padx=8)

        self.btn_clear_sources = ctk.CTkButton(
            source_buttons,
            text="CLEAR ALL",
            command=self.clear_sources
        )
        self.btn_clear_sources.pack(side="left", padx=8)

        # Database Name

        ctk.CTkLabel(
            panel,
            text="Database Name",
            font=("Segoe UI", 18, "bold")
        ).pack(anchor="w", padx=20)

        self.database_name = ctk.StringVar()

        self.entry_database = ctk.CTkEntry(
            panel,
            textvariable=self.database_name,
            placeholder_text="example: House Classics",
            height=36
        )

        self.entry_database.pack(
            fill="x",
            padx=20,
            pady=(10, 20)
        )

        self.split_database = ctk.BooleanVar(value=False)

        self.cb_split = ctk.CTkCheckBox(
            panel,
            text="Split database",
            variable=self.split_database,
            command=self.update_split_state
        )
        self.cb_split.pack(anchor="w", padx=20, pady=(0,10))

        ctk.CTkLabel(
            panel,
            text="Files per database"
        ).pack(anchor="w", padx=20)

        self.files_per_database = ctk.CTkEntry(panel, width=120)
        self.files_per_database.pack(anchor="w", padx=20, pady=(5,20))
        self.files_per_database.insert(0, "2000")

        self.files_label = ctk.CTkLabel(
            panel,
            text="Found files: 0"
        )
        self.files_label.pack(anchor="w", padx=20, pady=(0,20))

        self.progress = ctk.CTkProgressBar(panel)
        self.progress.pack(fill="x", padx=20, pady=(0,20))
        self.progress.set(0)

        # Create Button

        self.btn_create = ctk.CTkButton(
            panel,
            text="CREATE DATABASE",
            height=42,
            command=self.create_database
        )

        self.btn_create.pack(
            fill="x",
            padx=20,
            pady=(0, 10)
        )

        self.btn_merge = ctk.CTkButton(
            panel,
            text="MERGE DATABASES",
            height=42,
            command=self.merge_databases
        )

        self.btn_merge.pack(
            fill="x",
            padx=20,
            pady=(0,10)
        )

        self.btn_stop = ctk.CTkButton(
            panel,
            text="STOP",
            height=42,
            command=self.stop_current_operation,
            state="disabled"
        )
        self.btn_stop.pack(
            fill="x",
            padx=20,
            pady=(0,20)
        )

        self.console = ctk.CTkTextbox(panel,height=180)
        self.console._textbox.tag_configure("green", foreground="#00ff00")
        self.console._textbox.tag_configure("orange", foreground="#ff9900")
        self.console._textbox.tag_configure("red", foreground="#ff4444")
        self.console._textbox.tag_configure("cyan", foreground="#00d8ff")

        self.console.pack(fill="both", expand=True, padx=20, pady=(0,20))

        self.current_process = None
        self.current_operation = None

        self.update_split_state()

    def set_process_busy(self, busy):
        busy = bool(busy)

        if busy:
            self.btn_create.configure(state="disabled")
            self.btn_merge.configure(state="disabled")
            self.btn_add_folder.configure(state="disabled")
            self.btn_add_files.configure(state="disabled")
            self.btn_remove_source.configure(state="disabled")
            self.btn_clear_sources.configure(state="disabled")
            self.cb_split.configure(state="disabled")
            self.entry_database.configure(state="disabled")
            self.files_per_database.configure(state="disabled")
            self.btn_stop.configure(state="normal")
        else:
            self.btn_create.configure(state="normal")
            self.btn_merge.configure(state="normal")
            self.btn_add_folder.configure(state="normal")
            self.btn_add_files.configure(state="normal")
            self.btn_remove_source.configure(state="normal")
            self.btn_clear_sources.configure(state="normal")
            self.cb_split.configure(state="normal")
            self.entry_database.configure(state="normal")
            self.update_split_state()
            self.btn_stop.configure(state="disabled")
            self.current_process = None
            self.current_operation = None

    def stop_current_operation(self):
        process = self.current_process
        if process is not None:
            try:
                if process.poll() is None:
                    # Creator is a process tree: Node -> Python -> audfprint workers.
                    # Terminating only Node leaves the Python multiprocessing
                    # workers alive. Kill the complete child process tree on Windows.
                    if sys.platform == "win32":
                        subprocess.run(
                            [
                                "taskkill",
                                "/PID",
                                str(process.pid),
                                "/T",
                                "/F"
                            ],
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                            check=False
                        )
                    else:
                        process.terminate()
            except Exception:
                try:
                    if process.poll() is None:
                        process.terminate()
                except Exception:
                    pass

        self.write_log("\n[INFO]: Operation stopped by user.\n")
        self.winfo_toplevel().set_process_busy(False)

    def refresh_source_list(self):
        self.source_listbox.delete(0, "end")
        for path in self.source_paths:
            self.source_listbox.insert("end", path)

        exts = {".mp3",".wav",".flac",".m4a",".aif",".aiff",".ogg",".opus",".wma",".ape",".alac"}
        unique_files = set()

        for source in self.source_paths:
            source_path = Path(source)

            if source_path.is_dir():
                for file_path in source_path.rglob("*"):
                    if file_path.is_file() and file_path.suffix.lower() in exts:
                        unique_files.add(str(file_path.resolve()))

            elif source_path.is_file() and source_path.suffix.lower() in exts:
                unique_files.add(str(source_path.resolve()))

        self.files_label.configure(text=f"Found files: {len(unique_files)}")

    def add_source_folder(self):
        folder = filedialog.askdirectory(
            parent=self.winfo_toplevel(),
            title="Add source folder"
        )

        if folder:
            normalized = str(Path(folder).resolve())

            if normalized not in self.source_paths:
                self.source_paths.append(normalized)
                self.refresh_source_list()

    def add_source_files(self):
        files = filedialog.askopenfilenames(
            parent=self.winfo_toplevel(),
            title="Add audio files",
            filetypes=[
                (
                    "Audio Files",
                    "*.mp3 *.wav *.flac *.m4a *.aif *.aiff *.ogg *.opus *.wma *.ape *.alac"
                ),
                ("All Files", "*.*")
            ]
        )

        for file_path in files:
            normalized = str(Path(file_path).resolve())

            if normalized not in self.source_paths:
                self.source_paths.append(normalized)

        if files:
            self.refresh_source_list()

    def remove_selected_sources(self):
        indexes = list(self.source_listbox.curselection())

        for index in reversed(indexes):
            del self.source_paths[index]

        self.refresh_source_list()

    def clear_sources(self):
        self.source_paths.clear()
        self.refresh_source_list()

    def update_split_state(self):

        state = "normal" if self.split_database.get() else "disabled"
        self.files_per_database.configure(state=state)

    def write_log(self, text):

        # Use the text markers as the primary test. This keeps the
        # colors working even if Windows/Tk does not render the emoji.
        if "SUCCESS" in text:
            self.console._textbox.insert("end", text, ("green",))
        elif "POSSIBLE" in text:
            self.console._textbox.insert("end", text, ("orange",))
        elif "[ERROR]" in text or "ERROR:" in text:
            self.console._textbox.insert("end", text, ("red",))
        elif "[INFO]" in text:
            self.console._textbox.insert("end", text, ("cyan",))
        else:
            self.console._textbox.insert("end", text)

        self.console.see("end")
        self.update_idletasks()


    def merge_databases(self):
        """Open the database merge dialog.

        Only the Merge UI is changed here. Database creation and the actual
        Audfprint merge command remain unchanged.
        """

        window = ctk.CTkToplevel(self)
        window.title("Merge Databases")
        window.geometry("760x560")
        window.minsize(650, 480)
        window.transient(self.winfo_toplevel())
        window.grab_set()

        selected_files = []

        ctk.CTkLabel(
            window,
            text="Merge Databases",
            font=("Segoe UI", 24, "bold")
        ).pack(anchor="w", padx=20, pady=(20, 5))

        ctk.CTkLabel(
            window,
            text=(
                "Add 2 or more .pklz databases. They can be located in "
                "different folders.\n"
                "Use ADD DATABASES again to add databases from another folder."
            ),
            justify="left",
            anchor="w"
        ).pack(fill="x", padx=20, pady=(0, 15))

        list_frame = ctk.CTkFrame(window)
        list_frame.pack(fill="both", expand=True, padx=20, pady=(0, 10))

        ctk.CTkLabel(
            list_frame,
            text="Selected databases:",
            font=("Segoe UI", 15, "bold")
        ).pack(anchor="w", padx=12, pady=(10, 5))

        import tkinter as tk

        listbox = tk.Listbox(
            list_frame,
            selectmode=tk.EXTENDED,
            height=12
        )
        listbox.pack(fill="both", expand=True, padx=12, pady=(0, 12))

        def refresh_list():
            listbox.delete(0, tk.END)
            for path in selected_files:
                listbox.insert(tk.END, path)

        def add_databases():
            files = filedialog.askopenfilenames(
                parent=window,
                title="Add PKLZ databases",
                filetypes=[("PKLZ Database", "*.pklz")]
            )

            if not files:
                return

            for file_path in files:
                if file_path not in selected_files:
                    selected_files.append(file_path)

            refresh_list()

        def remove_selected():
            indexes = list(listbox.curselection())
            for index in reversed(indexes):
                del selected_files[index]
            refresh_list()

        def clear_all():
            selected_files.clear()
            refresh_list()

        buttons = ctk.CTkFrame(window, fg_color="transparent")
        buttons.pack(fill="x", padx=20, pady=(0, 10))

        ctk.CTkButton(
            buttons,
            text="ADD DATABASES",
            command=add_databases
        ).pack(side="left", padx=(0, 8))

        ctk.CTkButton(
            buttons,
            text="REMOVE SELECTED",
            command=remove_selected
        ).pack(side="left", padx=8)

        ctk.CTkButton(
            buttons,
            text="CLEAR ALL",
            command=clear_all
        ).pack(side="left", padx=8)

        def start_merge():
            if len(selected_files) < 2:
                messagebox.showwarning(
                    "Not enough databases",
                    "Please add at least 2 .pklz databases to merge.",
                    parent=window
                )
                return

            outfile = filedialog.asksaveasfilename(
                parent=window,
                title="Save merged database",
                defaultextension=".pklz",
                filetypes=[("PKLZ Database", "*.pklz")]
            )

            if not outfile:
                return

            # Prevent accidentally replacing one of the source databases.
            normalized_out = os.path.normcase(os.path.abspath(outfile))
            normalized_inputs = {
                os.path.normcase(os.path.abspath(path))
                for path in selected_files
            }

            if normalized_out in normalized_inputs:
                messagebox.showerror(
                    "Invalid output file",
                    "The merged database must be saved as a new file, "
                    "not over one of the source databases.",
                    parent=window
                )
                return

            window.grab_release()
            window.destroy()

            self.console.delete("1.0", "end")
            self.write_log("[INFO]: Starting database merge...\n")
            self.write_log(
                f"[INFO]: Merging {len(selected_files)} databases...\n"
            )

            self.winfo_toplevel().set_process_busy(True, "merge")

            threading.Thread(
                target=self.merge_database_thread,
                args=(tuple(selected_files), outfile),
                daemon=True
            ).start()

        ctk.CTkButton(
            window,
            text="MERGE DATABASES",
            height=42,
            command=start_merge
        ).pack(fill="x", padx=20, pady=(0, 20))

        window.protocol(
            "WM_DELETE_WINDOW",
            lambda: (window.grab_release(), window.destroy())
        )

    def merge_database_thread(self, files, outfile):

        try:
            root_dir = self.get_app_root()

            audfprint_dir = root_dir / "libs" / "audfprint"

            python_exe = root_dir / "runtime" / "python" / "python.exe"
            audfprint_script = root_dir / "libs" / "audfprint" / "audfprint.py"

            command = [
                str(python_exe),
                str(audfprint_script),
                "newmerge",
                "-d",
                outfile,
                *files
            ]

            child_env = os.environ.copy()
            child_env["PYTHONUTF8"] = "1"
            child_env["PYTHONIOENCODING"] = "utf-8"

            process = subprocess.Popen(
                command,
                cwd=root_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
                env=child_env,
                stdin=subprocess.DEVNULL,
            )

            self.current_process = process
            self.current_operation = "merge"

            for line in process.stdout:
                self.write_log(line)

            process.wait()

            if process.returncode == 0:
                self.write_log("\n[INFO]: Merge completed successfully.\n")
            else:
                self.write_log(f"\nProcess exited with code {process.returncode}\n")

        except Exception as e:
            self.write_log(f"\nERROR:\n{e}\n")
        finally:
            self.winfo_toplevel().set_process_busy(False)

    def create_database(self):
        if not self.source_paths:
            messagebox.showwarning(
                "No source selected",
                "Please add at least one folder or audio file.",
                parent=self.winfo_toplevel()
            )
            return

        if not self.database_name.get().strip():
            messagebox.showwarning(
                "Database name required",
                "Please enter a database name.",
                parent=self.winfo_toplevel()
            )
            return

        sources = tuple(self.source_paths)

        self.console.delete("1.0","end")
        self.progress.set(0)
        self.winfo_toplevel().set_process_busy(True, "create")

        threading.Thread(
            target=self.create_database_thread,
            args=(sources,),
            daemon=True
        ).start()

    def create_database_thread(self, sources):
        try:
            root_dir = self.get_app_root()

            node_exe = root_dir / "runtime" / "node" / "node.exe"

            command = [
                str(node_exe),
                "werzatsong.js",
                "--fingerprint",
                "--source",
                *sources,
                "--dbname",
                self.database_name.get()
            ]

            if self.split_database.get():
                command.extend([
                    "--split",
                    "--files-per-database",
                    self.files_per_database.get()
                ])

            child_env = os.environ.copy()
            child_env["PYTHONUTF8"] = "1"
            child_env["PYTHONIOENCODING"] = "utf-8"

            process = subprocess.Popen(
                command,
                cwd=root_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
                env=child_env,
                stdin=subprocess.DEVNULL,
            )

            self.current_process = process
            self.current_operation = "create"

            for line in process.stdout:
                self.write_log(line)
            process.wait()
            if process.returncode==0:
                self.progress.set(1)
                self.write_log("\nFinished.\n")
            else:
                self.write_log(f"\nProcess exited with code {process.returncode}\n")
        except Exception as e:
            self.write_log(f"\nERROR:\n{e}\n")
        finally:
            self.winfo_toplevel().set_process_busy(False)
