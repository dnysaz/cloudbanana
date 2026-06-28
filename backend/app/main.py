import os, re, time, secrets, shutil, subprocess, asyncio
import pty, fcntl, struct, termios, select
import psutil
from datetime import datetime
from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from sqlmodel import Session, select
from sqlalchemy.exc import IntegrityError
from app.utils.system import run_command
from app.database import init_db, engine
from app.models import User
from app.auth import hash_password, verify_password, create_access_token, get_current_user, require_admin
from app.apps import APPS, get_all_status, get_script_path
from pathlib import Path
from pydantic import BaseModel, field_validator

app = FastAPI(title="CloudBanana DE API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    init_db()

def background_installer(script_path: str):
    if os.path.exists(script_path):
        run_command(["bash", script_path], timeout=300)

class RegisterBody(BaseModel):
    username: str
    email: str
    password: str

    @field_validator("username")
    @classmethod
    def valid_username(cls, v):
        if not re.match(r"^[a-zA-Z0-9_]{3,32}$", v):
            raise ValueError("Username must be 3-32 chars: letters, numbers, underscores only")
        return v

    @field_validator("password")
    @classmethod
    def strong_password(cls, v):
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v

    @field_validator("email")
    @classmethod
    def valid_email(cls, v):
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v):
            raise ValueError("Invalid email format")
        return v

class LoginBody(BaseModel):
    username: str
    password: str

class CreateUserBody(BaseModel):
    username: str
    email: str
    password: str
    role: str = "user"

    @field_validator("username")
    @classmethod
    def valid_username(cls, v):
        if not re.match(r"^[a-zA-Z0-9_]{3,32}$", v):
            raise ValueError("Username must be 3-32 chars: letters, numbers, underscores only")
        return v

    @field_validator("password")
    @classmethod
    def strong_password(cls, v):
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v

    @field_validator("email")
    @classmethod
    def valid_email(cls, v):
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v):
            raise ValueError("Invalid email format")
        return v

    @field_validator("role")
    @classmethod
    def valid_role(cls, v):
        if v not in ("admin", "user"):
            raise ValueError("Role must be admin or user")
        return v

@app.get("/api/v1/auth/check")
async def check_admin_exists():
    with Session(engine) as session:
        admin = session.exec(select(User).where(User.role == "admin")).first()
        return {"admin_exists": admin is not None}

@app.post("/api/v1/auth/register")
async def register_admin(body: RegisterBody):
    with Session(engine) as session:
        admin = session.exec(select(User).where(User.role == "admin")).first()
        if admin:
            raise HTTPException(status_code=400, detail="Admin already exists")
        user = User(
            username=body.username,
            email=body.email,
            hashed_password=hash_password(body.password),
            role="admin"
        )
        session.add(user)
        try:
            session.commit()
            session.refresh(user)
        except IntegrityError:
            session.rollback()
            raise HTTPException(status_code=400, detail="Username or email already taken")
    return {"status": "success", "message": "Admin registered successfully"}

@app.post("/api/v1/auth/login")
async def login(body: LoginBody):
    with Session(engine) as session:
        user = session.exec(select(User).where(User.username == body.username)).first()
        if not user or not verify_password(body.password, user.hashed_password):
            raise HTTPException(status_code=401, detail="Invalid username or password")
        token = create_access_token({"sub": user.username, "role": user.role})
        return {"access_token": token, "token_type": "bearer", "role": user.role}

@app.get("/api/v1/auth/me")
async def get_me(user: User = Depends(get_current_user)):
    return {"id": user.id, "username": user.username, "email": user.email, "role": user.role}

@app.get("/api/v1/auth/users")
async def list_users(admin: User = Depends(require_admin)):
    with Session(engine) as session:
        users = session.exec(select(User)).all()
        return [
            {"id": u.id, "username": u.username, "email": u.email, "role": u.role, "created_at": u.created_at.isoformat()}
            for u in users
        ]

@app.post("/api/v1/auth/users")
async def create_user(body: CreateUserBody, admin: User = Depends(require_admin)):
    with Session(engine) as session:
        user = User(
            username=body.username,
            email=body.email,
            hashed_password=hash_password(body.password),
            role=body.role
        )
        session.add(user)
        try:
            session.commit()
            session.refresh(user)
        except IntegrityError:
            session.rollback()
            raise HTTPException(status_code=400, detail="Username or email already taken")
    return {"status": "success", "message": f"User {body.username} created"}

@app.get("/api/v1/system/stats")
async def get_system_stats(user: User = Depends(get_current_user)):
    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()
    return {
        "cpu": psutil.cpu_percent(interval=1),
        "ram_percent": mem.percent,
        "ram_used": mem.used,
        "ram_total": mem.total,
        "swap_percent": swap.percent,
        "swap_used": swap.used,
        "swap_total": swap.total,
        "disk_percent": psutil.disk_usage('/').percent,
        "uptime_seconds": int(time.time() - psutil.boot_time())
    }

@app.get("/api/v1/apps/status")
async def list_apps(user: User = Depends(get_current_user)):
    return get_all_status()

@app.post("/api/v1/apps/install/{app_id}")
async def install_app(app_id: str, background_tasks: BackgroundTasks, user: User = Depends(get_current_user)):
    app_def = next((a for a in APPS if a["id"] == app_id), None)
    if not app_def:
        raise HTTPException(status_code=400, detail="Application not supported")
    script_path = get_script_path(app_def["script"])
    if not os.path.exists(script_path):
        raise HTTPException(status_code=500, detail="Installation script not found")
    background_tasks.add_task(background_installer, script_path)
    return {"status": "success", "message": f"Installing {app_def['name']} in the background. Refresh to see version."}

class CreateFolderBody(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def valid_name(cls, v):
        if not re.match(r"^[a-zA-Z0-9_-]{1,64}$", v):
            raise ValueError("Invalid folder name")
        return v

class SubdomainBody(BaseModel):
    domain: str
    subdomain: str
    target_dir: str = "/var/www"

    @field_validator("domain")
    @classmethod
    def valid_domain(cls, v):
        if not re.match(r"^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$", v):
            raise ValueError("Invalid domain")
        return v

    @field_validator("subdomain")
    @classmethod
    def valid_subdomain(cls, v):
        if not re.match(r"^[a-zA-Z0-9_-]{1,64}$", v):
            raise ValueError("Invalid subdomain name")
        return v

@app.get("/api/v1/www")
async def list_www(user: User = Depends(get_current_user)):
    www = Path("/var/www")
    if not www.exists():
        return {"items": []}
    items = []
    for child in sorted(www.iterdir()):
        items.append({
            "name": child.name,
            "is_dir": child.is_dir(),
            "size": child.stat().st_size if child.is_file() else 0,
        })
    return {"items": items}

@app.post("/api/v1/www")
async def create_www_folder(body: CreateFolderBody, user: User = Depends(get_current_user)):
    folder = Path("/var/www") / body.name
    if folder.exists():
        raise HTTPException(status_code=400, detail="Folder already exists")
    folder.mkdir(parents=True, exist_ok=True)
    return {"status": "success", "message": f"Folder /var/www/{body.name} created"}

@app.post("/api/v1/subdomain")
async def create_subdomain(body: SubdomainBody, background_tasks: BackgroundTasks, user: User = Depends(get_current_user)):
    target = Path(body.target_dir)
    config = f"""server {{
    listen 80;
    server_name {body.subdomain}.{body.domain};

    root {target / body.subdomain};
    index index.html index.htm index.php;

    location / {{
        try_files $uri $uri/ =404;
    }}
}}
"""
    config_path = Path(f"/etc/nginx/sites-available/{body.subdomain}.{body.domain}")
    config_path.write_text(config)
    enabled = Path(f"/etc/nginx/sites-enabled/{body.subdomain}.{body.domain}")
    if not enabled.exists():
        enabled.symlink_to(config_path)
    background_tasks.add_task(lambda: run_command(["nginx", "-t"]) and run_command(["systemctl", "reload", "nginx"]))
    return {"status": "success", "message": f"Subdomain {body.subdomain}.{body.domain} configured"}

# ========== File Manager API ==========

class FileAction(BaseModel):
    path: str
    password: str = ""

class WriteFileBody(BaseModel):
    path: str
    content: str

def safe_path(user_path: str) -> Path:
    p = Path(user_path).resolve()
    if not str(p).startswith('/'):
        raise HTTPException(status_code=400, detail="Invalid path")
    return p

def verify_root_password(password: str) -> bool:
    try:
        if os.geteuid() == 0:
            import crypt
            with open('/etc/shadow') as f:
                for line in f:
                    if line.startswith('root:'):
                        hashed = line.split(':')[1]
                        if hashed in ('*', '!', 'x'):
                            return False
                        return crypt.crypt(password, hashed) == hashed
            return False
        proc = subprocess.run(
            ["su", "-c", "echo ok", "root"],
            input=password + "\n", capture_output=True, text=True, timeout=5
        )
        return proc.returncode == 0
    except:
        return False

@app.get("/api/v1/files")
async def list_files(path: str = "/", user = Depends(get_current_user)):
    p = safe_path(path)
    if not p.exists() or not p.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")
    items = []
    for child in sorted(p.iterdir()):
        try:
            stat = child.stat()
            items.append({
                "name": child.name,
                "is_dir": child.is_dir(),
                "size": stat.st_size if child.is_file() else 0,
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat()
            })
        except PermissionError:
            items.append({
                "name": child.name, "is_dir": child.is_dir(),
                "size": 0, "modified": ""
            })
    return {"items": items, "path": str(p)}

@app.post("/api/v1/files/mkdir")
async def create_folder(body: FileAction, user = Depends(get_current_user)):
    p = safe_path(body.path)
    if p.exists():
        raise HTTPException(status_code=400, detail="Path already exists")
    p.mkdir(parents=True, exist_ok=False)
    return {"status": "ok"}

@app.post("/api/v1/files/read")
async def read_file(body: FileAction, user = Depends(get_current_user)):
    p = safe_path(body.path)
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    content = p.read_text(encoding='utf-8', errors='replace')
    return {"content": content, "path": str(p)}

@app.post("/api/v1/files/write")
async def write_file(body: WriteFileBody, user = Depends(get_current_user)):
    p = safe_path(body.path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(body.content, encoding='utf-8')
    return {"status": "ok"}

@app.post("/api/v1/files/remove")
async def remove_file(body: FileAction, user = Depends(get_current_user)):
    if not body.password or not verify_root_password(body.password):
        raise HTTPException(status_code=403, detail="Root password required")
    p = safe_path(body.path)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Path not found")
    if p.is_dir():
        shutil.rmtree(p)
    else:
        p.unlink()
    return {"status": "ok"}

# ========== wget API ==========

_wget_tasks = {}

class WgetBody(BaseModel):
    url: str
    dir: str = "/root"

@app.post("/api/v1/wget")
async def wget_download(body: WgetBody, background_tasks: BackgroundTasks, user = Depends(get_current_user)):
    if not re.match(r'^https?://', body.url):
        raise HTTPException(status_code=400, detail="Invalid URL")
    tid = secrets.token_hex(8)
    _wget_tasks[tid] = {"url": body.url, "status": "running", "output": ""}
    background_tasks.add_task(_run_wget, tid, body.url, body.dir)
    return {"task_id": tid, "status": "running"}

def _run_wget(tid, url, d):
    try:
        result = run_command(["wget", "-P", d, url], timeout=300)
        _wget_tasks[tid] = {"url": url, "status": "done", "output": result or "Download completed"}
    except Exception as e:
        _wget_tasks[tid] = {"url": url, "status": "error", "output": str(e)}

@app.get("/api/v1/wget/status/{task_id}")
async def wget_status(task_id: str, user = Depends(get_current_user)):
    t = _wget_tasks.get(task_id)
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    return t

# ========== Terminal (WebSocket PTY) ==========

def _set_nonblock(fd):
    fl = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)

def _set_winsize(fd, rows, cols):
    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)

@app.websocket("/api/v1/terminal/ws")
async def terminal_ws(ws: WebSocket):
    await ws.accept()
    master_fd, slave_fd = pty.openpty()
    pid = os.fork()
    if pid == 0:
        os.close(master_fd)
        os.setsid()
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        if slave_fd > 2:
            os.close(slave_fd)
        os.environ['TERM'] = 'xterm-256color'
        os.execpe('/bin/bash', '/bin/bash', '--login', os.environ)
    os.close(slave_fd)
    _set_nonblock(master_fd)
    _set_winsize(master_fd, 24, 80)

    loop = asyncio.get_event_loop()

    async def pty_to_ws():
        while True:
            try:
                r, _, _ = select.select([master_fd], [], [], 0.05)
                if r:
                    data = await loop.run_in_executor(None, os.read, master_fd, 4096)
                    if not data:
                        break
                    await ws.send_bytes(data)
                else:
                    await asyncio.sleep(0.01)
            except:
                break

    async def ws_to_pty():
        while True:
            try:
                data = await ws.receive_bytes()
                if data.startswith(b'\x1b[8;'):
                    try:
                        parts = data.decode().split(';')
                        rows = int(parts[1])
                        cols = int(parts[2].rstrip('t'))
                        _set_winsize(master_fd, rows, cols)
                    except:
                        pass
                else:
                    os.write(master_fd, data)
            except:
                break

    await asyncio.gather(pty_to_ws(), ws_to_pty())
    os.close(master_fd)
    os.waitpid(pid, 0)

frontend_path = Path(__file__).resolve().parent.parent.parent / "frontend"

@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    if not frontend_path.exists():
        raise HTTPException(status_code=404)
    if full_path:
        target = frontend_path / full_path
        if target.is_file():
            return FileResponse(target)
    index = frontend_path / "index.html"
    if index.exists():
        return FileResponse(index, media_type="text/html")
    raise HTTPException(status_code=404)

@app.exception_handler(Exception)
async def catch_all_exception_handler(request, exc):
    if isinstance(exc, StarletteHTTPException):
        raise exc
    import traceback
    traceback.print_exc()
    return JSONResponse(status_code=500, content={"detail": str(exc)})
