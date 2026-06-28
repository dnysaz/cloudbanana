from sqlmodel import SQLModel, Field
from datetime import datetime
from typing import Optional

class Site(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    domain: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

class Log(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    action: str
    status: str
    message: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

class Setting(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str

class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(unique=True, index=True)
    email: str
    hashed_password: str
    role: str = Field(default="user")
    created_at: datetime = Field(default_factory=datetime.utcnow)
