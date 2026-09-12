from __future__ import annotations

import os
from typing import Optional

from fastapi import Header, HTTPException
from supabase import Client, create_client


class AuthConfigError(RuntimeError):
    """The server cannot check tokens at all - not the caller's fault."""


def get_supabase_admin() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    missing = [n for n, v in (("SUPABASE_URL", url), ("SUPABASE_SERVICE_ROLE_KEY", key)) if not v]
    if missing:
        raise AuthConfigError("missing environment: " + ", ".join(missing))
    try:
        return create_client(url, key)
    except Exception as exc:
        raise AuthConfigError(f"could not build the Supabase admin client: {exc}") from exc


async def get_current_practitioner(authorization: Optional[str] = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = authorization.replace("Bearer ", "", 1).strip()

    # Build the client first, on its own. Folding this into the same try as the
    # token check reported a server misconfiguration as "Invalid token": with
    # SUPABASE_SERVICE_ROLE_KEY unset the backend never called Supabase at all,
    # yet every signed-in user was told their token was bad. 401 is a claim about
    # the caller, so only say it when Supabase actually rejected them.
    try:
        supabase = get_supabase_admin()
    except AuthConfigError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Server auth is not configured: {exc}",
        ) from exc

    try:
        user = supabase.auth.get_user(token)
    except Exception as exc:
        raise HTTPException(
            status_code=401, detail=f"Invalid token: {exc}"
        ) from exc

    if not user or not getattr(user, "user", None):
        raise HTTPException(status_code=401, detail="Invalid token")

    return str(user.user.id)


async def get_current_practitioner_optional(
    authorization: Optional[str] = Header(default=None),
) -> Optional[str]:
    if not authorization:
        return None
    return await get_current_practitioner(authorization)
