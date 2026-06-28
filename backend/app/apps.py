import re
import shutil
from app.utils.system import run_command

APPS = [
    {
        "id": "docker",
        "name": "Docker",
        "desc": "Container runtime & orchestration",
        "script": "install_docker.sh",
        "binary": "docker",
        "version_args": ["--version"],
        "version_re": r"([\d.]+)",
    },
    {
        "id": "nginx",
        "name": "Nginx",
        "desc": "Web server & reverse proxy",
        "script": "install_nginx.sh",
        "binary": "nginx",
        "version_args": ["-v"],
        "version_re": r"nginx/([\d.]+)",
    },
    {
        "id": "apache",
        "name": "Apache",
        "desc": "HTTP web server",
        "script": "install_apache.sh",
        "binary": "apache2",
        "version_args": ["-v"],
        "version_re": r"Apache/([\d.]+)",
    },
    {
        "id": "php",
        "name": "PHP",
        "desc": "Server-side scripting language",
        "script": "install_php.sh",
        "binary": "php",
        "version_args": ["-v"],
        "version_re": r"PHP ([\d.]+)",
    },
    {
        "id": "python",
        "name": "Python",
        "desc": "General-purpose programming language",
        "script": "install_python.sh",
        "binary": "python3",
        "version_args": ["--version"],
        "version_re": r"Python ([\d.]+)",
    },
    {
        "id": "nodejs",
        "name": "Node.js",
        "desc": "JavaScript runtime environment",
        "script": "install_nodejs.sh",
        "binary": "node",
        "version_args": ["--version"],
        "version_re": r"v?([\d.]+)",
    },
    {
        "id": "phpmyadmin",
        "name": "phpMyAdmin",
        "desc": "MySQL administration tool",
        "script": "install_phpmyadmin.sh",
        "binary": "phpmyadmin",
        "check_pkg": "phpmyadmin",
        "version_args": [],
        "version_re": None,
    },
    {
        "id": "certbot",
        "name": "Certbot",
        "desc": "SSL/TLS certificate manager",
        "script": "install_certbot.sh",
        "binary": "certbot",
        "version_args": ["--version"],
        "version_re": r"certbot ([\d.]+)",
    },
]

def check_app(app_def: dict) -> dict:
    result = {
        "id": app_def["id"],
        "name": app_def["name"],
        "desc": app_def["desc"],
        "installed": False,
        "version": None,
    }
    if "check_pkg" in app_def:
        ok, out = run_command(["dpkg", "-l", app_def["check_pkg"]])
        if not ok or "ii" not in out:
            return result
        result["installed"] = True
        m = re.search(r"ii\s+\S+\s+([\d.]+)", out)
        if m:
            result["version"] = m.group(1)
        return result
    binary = shutil.which(app_def["binary"])
    if not binary:
        return result
    result["installed"] = True
    args = app_def["version_args"]
    if not args:
        return result
    ok, output = run_command([binary] + args)
    if ok:
        match = re.search(app_def["version_re"], output)
        if match:
            result["version"] = match.group(1)
    else:
        match = re.search(app_def["version_re"], output)
        if match:
            result["version"] = match.group(1)
    return result

def get_script_path(script_name: str, install_dir: str = "/etc/cloudbanana") -> str:
    return f"{install_dir}/scripts/{script_name}"

def get_all_status() -> list[dict]:
    return [check_app(a) for a in APPS]
