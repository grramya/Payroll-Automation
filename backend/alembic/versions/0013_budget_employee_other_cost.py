"""0013 — add budget_employee_cost and budget_other_cost tables

Tables for the Budget module: Employee Cost and Other Cost planning sections.

Revision ID: 0013
Revises: 0012
Create Date: 2026-05-13
"""

from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    existing = sa.inspect(op.get_bind()).get_table_names()
    if "budget_employee_cost" not in existing:
        op.create_table(
            "budget_employee_cost",
            sa.Column("id",                  sa.Integer(),               primary_key=True, autoincrement=True),
            sa.Column("department",           sa.String(255),             nullable=False),
            sa.Column("year",                 sa.Integer(),               nullable=False),
            sa.Column("geography",            sa.String(100),             nullable=False),
            sa.Column("name",                 sa.String(255),             nullable=False),
            sa.Column("title",                sa.String(255),             nullable=False),
            sa.Column("start_date",           sa.Date(),                  nullable=True),
            sa.Column("base_salary",          sa.Float(),                 nullable=False),
            sa.Column("bonus_pct",            sa.Float(),                 nullable=True),
            sa.Column("bonus_amount",         sa.Float(),                 nullable=True),
            sa.Column("taxes_benefits_pct",   sa.Float(),                 nullable=False, server_default="0"),
            sa.Column("hike_cycle_pct",       sa.Float(),                 nullable=True),
            sa.Column("payroll_expenses",     sa.Float(),                 nullable=True),
            sa.Column("tech_stipend",         sa.Float(),                 nullable=True),
            sa.Column("created_at",           sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at",           sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_budget_emp_cost_dept_year", "budget_employee_cost", ["department", "year"])
        op.create_index(
            "uq_budget_emp_cost_dept_year_name", "budget_employee_cost",
            ["department", "year", "name"], unique=True,
        )
    if "budget_other_cost" not in existing:
        op.create_table(
            "budget_other_cost",
            sa.Column("id",               sa.Integer(),               primary_key=True, autoincrement=True),
            sa.Column("department",        sa.String(255),             nullable=False),
            sa.Column("year",              sa.Integer(),               nullable=False),
            sa.Column("cost_grouping",     sa.String(255),             nullable=False),
            sa.Column("vendor_name",       sa.String(255),             nullable=False),
            sa.Column("memo_description",  sa.Text(),                  nullable=True),
            sa.Column("amount",            sa.Float(),                 nullable=False),
            sa.Column("created_at",        sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at",        sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_budget_other_cost_dept_year", "budget_other_cost", ["department", "year"])


def downgrade() -> None:
    op.drop_index("ix_budget_other_cost_dept_year", table_name="budget_other_cost")
    op.drop_table("budget_other_cost")
    op.drop_index("uq_budget_emp_cost_dept_year_name", table_name="budget_employee_cost")
    op.drop_index("ix_budget_emp_cost_dept_year", table_name="budget_employee_cost")
    op.drop_table("budget_employee_cost")
