Berikut adalah Blueprint MVP CloudBanana.org yang dirancang secara strictly minimalist, fokus pada efisiensi performa (ringan), keandalan kode, dan kemudahan instalasi self-hosted.

1. Arsitektur Sistem
Aplikasi ini akan berjalan secara lokal di VPS pengguna sebagai sebuah systemd service di latar belakang, diproteksi oleh Nginx sebagai reverse proxy.

[Browser Pengguna] 
       │ (Akses via http://<IP_VPS>:8080)
       ▼
[Nginx Reverse Proxy]
       │ (Meneruskan request secara lokal)
       ▼
[FastAPI Backend] ───(Menggunakan subprocess)───► [Sistem Operasi Linux VPS]
       │
       ▼
[SQLite Database] (Penyimpanan data lokal)
2. Struktur Folder Proyek (Monorepo Minimalis)
Plaintext
cloudbanana/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py          # Entry point FastAPI & rute API
│   │   ├── database.py      # Setup SQLite & SQLAlchemy/SQLModel
│   │   ├── models.py        # Schema database (Sites, Logs, Settings)
│   │   └── utils/
│   │       ├── __init__.py
│   │       └── system.py    # Fungsi eksekusi perintah shell (subprocess)
│   └── requirements.txt     # Dependensi Python (fastapi, uvicorn, sqlmodel, dll.)
├── frontend/
│   ├── index.html           # UI utama (Single Page Application)
│   ├── app.js               # Logika frontend & fetch API
│   └── style.css            # Desain UI minimalis/brutalist
├── scripts/
│   ├── install_docker.sh    # Skrip instalasi Docker otomatis
│   └── setup_nginx.sh       # Skrip konfigurasi virtual host Nginx
└── install.sh               # The 1-Line Master Installer untuk pengguna
3. Komponen Utama Kode MVP (Python Backend)
Semua komentar di dalam kode menggunakan bahasa Inggris sesuai standar pengembangan global proyek open-source.

A. Core Engine Eksekutor Perintah (backend/app/utils/system.py)
Menggunakan pustaka subprocess bawaan Python untuk mengeksekusi perintah langsung di server lokal.

Python
import subprocess
import logging

logger = logging.getLogger("cloudbanana")

def run_command(command: list[str]) -> tuple[bool, str]:
    """
    Execute a system command locally and return a tuple of (success_status, output_message).
    """
    try:
        # Run command safely without shell=True to prevent command injection vulnerabilities
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=True
        )
        return True, result.stdout
    except subprocess.CalledProcessError as e:
        logger.error(f"Command failed: {' '.join(command)} | Error: {e.stderr}")
        return False, e.stderr
    except Exception as e:
        logger.error(f"Unexpected error executing command: {str(e)}")
        return False, str(e)
B. Main API Application (backend/app/main.py)
Menyediakan endpoint untuk memantau server dan memicu instalasi utilitas.

Python
import os
import psutil
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.utils.system import run_command

app = FastAPI(title="CloudBanana Core API", version="0.1.0")

# Enable CORS for frontend interaction
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def background_installer(script_path: str):
    """
    Execute installation scripts safely in the background.
    """
    if os.path.exists(script_path):
        run_command(["bash", script_path])

@app.get("/api/v1/system/stats")
async def get_system_stats():
    """
    Fetch basic real-time resource utilization stats from the VPS.
    """
    return {
        "cpu_usage": psutil.cpu_percent(interval=1),
        "ram_usage": psutil.virtual_memory().percent,
        "disk_usage": psutil.disk_usage('/').percent
    }

@app.post("/api/v1/apps/install/{app_name}")
async def trigger_app_installation(app_name: str, background_tasks: BackgroundTasks):
    """
    Trigger the installation of supported applications asynchronously.
    """
    supported_apps = ["docker", "nginx", "nodejs"]
    if app_name not in supported_apps:
        raise HTTPException(status_code=400, detail="Application not supported in MVP.")
    
    script_map = {
        "docker": "/etc/cloudbanana/scripts/install_docker.sh",
    }
    
    script_path = script_map.get(app_name)
    if not script_path:
        raise HTTPException(status_code=500, detail="Installation script mapping missing.")
        
    background_tasks.add_task(background_installer, script_path)
    return {"status": "success", "message": f"Installation of {app_name} started in the background."}

# Serve frontend static files
# Make sure frontend directory exists before mounting in production
# app.mount("/", StaticFiles(directory="../frontend", html=True), name="frontend")
4. Alur Distribusi & Peta Jalan Master Installer (install.sh)
Skrip inilah yang akan dipanggil pengguna melalui perintah 1 baris. Skrip ini diletakkan pada repositori git publik Anda.

Validasi Lingkungan: Memastikan OS adalah Ubuntu 22.04 LTS / 24.04 LTS dan dijalankan sebagai root.

Instalasi Dependensi Dasar: Menjalankan apt-get update && apt-get install -y python3-pip python3-venv nginx git.

Kloning Proyek: Mengunduh kode sumber CloudBanana dari GitHub ke direktori /etc/cloudbanana/.

Setup Virtual Environment: Membuat lingkungan terisolasi Python (python3 -m venv venv) dan menginstal isi requirements.txt.

Registrasi Systemd: Membuat berkas /etc/systemd/system/cloudbanana.service agar aplikasi otomatis menyala saat server hidup.

Konfigurasi Nginx: Mengarahkan port :8080 (atau port pilihan) ke socket Uvicorn (127.0.0.1:8000).

5. Target Akhir Pengujian MVP
Saat semua komponen di atas digabungkan, indikator keberhasilan MVP Anda adalah:

[ ] Pengguna bisa mengakses dashboard via web browser.

[ ] Angka pemakaian CPU/RAM/Disk bergerak secara dinamis sesuai kondisi asli server.

[ ] Ketika tombol "Install Docker" ditekan di UI, proses instalasi berjalan di latar belakang VPS dan Docker sukses terpasang secara permanen di sistem tanpa merusak sistem operasi bawaan.
