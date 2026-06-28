import os
import re
import time
import psutil
from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends
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
