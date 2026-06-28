import subprocess
import logging

logger = logging.getLogger("cloudbanana")

def run_command(command: list[str], timeout: int = 60) -> tuple[bool, str]:
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=True,
            timeout=timeout
        )
        return True, result.stdout
    except subprocess.TimeoutExpired:
        logger.error(f"Command timed out: {' '.join(command)}")
        return False, "Command timed out"
    except subprocess.CalledProcessError as e:
        logger.error(f"Command failed: {' '.join(command)} | Error: {e.stderr}")
        return False, e.stderr
    except Exception as e:
        logger.error(f"Unexpected error executing command: {str(e)}")
        return False, str(e)
