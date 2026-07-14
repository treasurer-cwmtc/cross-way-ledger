from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import AppSetting
from ..schemas import AppSettingOut, AppSettingUpdate

router = APIRouter(
    prefix="/api/settings", tags=["settings"], dependencies=[Depends(get_current_user)]
)


@router.get("", response_model=list[AppSettingOut])
def list_settings(db: Session = Depends(get_db)) -> list[AppSetting]:
    return list(db.scalars(select(AppSetting)))


@router.get("/{key}", response_model=AppSettingOut)
def get_setting(key: str, db: Session = Depends(get_db)) -> AppSetting:
    setting = db.get(AppSetting, key)
    if setting is None:
        raise HTTPException(status_code=404, detail="Setting not found.")
    return setting


@router.put("/{key}", response_model=AppSettingOut)
def update_setting(key: str, payload: AppSettingUpdate, db: Session = Depends(get_db)) -> AppSetting:
    setting = db.get(AppSetting, key)
    if setting is None:
        setting = AppSetting(key=key, value=payload.value)
        db.add(setting)
    else:
        setting.value = payload.value
    db.commit()
    db.refresh(setting)
    return setting
