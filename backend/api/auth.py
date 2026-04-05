from __future__ import annotations

import os
from typing import Optional

from fastapi import Header, HTTPException
from supabase import Client, create_client


def get_supabase_admin() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    return create_client(url, key)


async def get_current_practitioner(authorization: Optional[str] = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = authorization.replace("Bearer ", "", 1).strip()

    try:
        supabase = get_supabase_admin()
        user = supabase.auth.get_user(token)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc

    if not user or not getattr(user, "user", None):
        raise HTTPException(status_code=401, detail="Invalid token")

    return str(user.user.id)


async def get_current_practitioner_optional(
    authorization: Optional[str] = Header(default=None),
) -> Optional[str]:
    if not authorization:
        return None
    return await get_current_practitioner(authorization)
