import os
import re
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
from pathlib import Path
from pydantic import BaseModel, field_validator

app = FastAPI(title="CloudBanana Core API", version="0.1.0")

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
        "disk_percent": psutil.disk_usage('/').percent
    }

@app.post("/api/v1/apps/install/{app_name}")
async def trigger_app_installation(app_name: str, background_tasks: BackgroundTasks, user: User = Depends(get_current_user)):
    supported_apps = {"docker": "/etc/cloudbanana/scripts/install_docker.sh"}
    script_path = supported_apps.get(app_name)
    if not script_path:
        raise HTTPException(status_code=400, detail="Application not supported")
    if not os.path.exists(script_path):
        raise HTTPException(status_code=500, detail="Installation script not found")
    background_tasks.add_task(background_installer, script_path)
    return {"status": "success", "message": f"Installation of {app_name} started in the background."}

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
