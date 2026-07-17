from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_permission
from ..models import CategoryRule
from ..schemas import CategoryRuleCreate, CategoryRuleOut, CategoryRuleUpdate

router = APIRouter(
    prefix="/api/rules", tags=["rules"], dependencies=[Depends(require_permission("rules"))]
)

VALID_TYPES = {"bank_keyword", "stripe_fund"}


@router.get("", response_model=list[CategoryRuleOut])
def list_rules(
    rule_type: str | None = None, db: Session = Depends(get_db)
) -> list[CategoryRule]:
    stmt = select(CategoryRule).order_by(
        CategoryRule.rule_type, CategoryRule.priority, CategoryRule.id
    )
    if rule_type:
        stmt = stmt.where(CategoryRule.rule_type == rule_type)
    return list(db.scalars(stmt).all())


@router.post("", response_model=CategoryRuleOut, status_code=201)
def create_rule(
    payload: CategoryRuleCreate, db: Session = Depends(get_db)
) -> CategoryRule:
    if payload.rule_type not in VALID_TYPES:
        raise HTTPException(400, f"rule_type must be one of {sorted(VALID_TYPES)}")
    if not payload.pattern.strip():
        raise HTTPException(400, "pattern is required")
    rule = CategoryRule(**payload.model_dump())
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


@router.put("/{rule_id}", response_model=CategoryRuleOut)
def update_rule(
    rule_id: int, payload: CategoryRuleUpdate, db: Session = Depends(get_db)
) -> CategoryRule:
    rule = db.get(CategoryRule, rule_id)
    if rule is None:
        raise HTTPException(404, "Rule not found")
    data = payload.model_dump(exclude_unset=True)
    if "rule_type" in data and data["rule_type"] not in VALID_TYPES:
        raise HTTPException(400, f"rule_type must be one of {sorted(VALID_TYPES)}")
    for key, value in data.items():
        setattr(rule, key, value)
    db.commit()
    db.refresh(rule)
    return rule


@router.delete("/{rule_id}", status_code=204)
def delete_rule(rule_id: int, db: Session = Depends(get_db)) -> None:
    rule = db.get(CategoryRule, rule_id)
    if rule is None:
        raise HTTPException(404, "Rule not found")
    db.delete(rule)
    db.commit()
