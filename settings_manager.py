import json
from pathlib import Path

# Plik settings.json znajduje się w głównym katalogu programu
SETTINGS_FILE = Path(__file__).parent / "settings.json"

# Domyślne ustawienia
DEFAULT_SETTINGS = {
    "threads": "auto"
}


def load_settings():
    """
    Odczytuje ustawienia z settings.json.
    Jeśli plik nie istnieje lub jest uszkodzony,
    tworzy nowy z ustawieniami domyślnymi.
    """

    if not SETTINGS_FILE.exists():
        save_settings(DEFAULT_SETTINGS)
        return DEFAULT_SETTINGS.copy()

    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            settings = json.load(f)

        # Dodaj brakujące opcje (na przyszłość)
        for key, value in DEFAULT_SETTINGS.items():
            settings.setdefault(key, value)

        return settings

    except Exception:
        save_settings(DEFAULT_SETTINGS)
        return DEFAULT_SETTINGS.copy()


def save_settings(settings):
    """
    Zapisuje ustawienia do settings.json.
    """

    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=4)