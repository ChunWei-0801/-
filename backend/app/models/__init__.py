"""
所有資料表。import 這個套件，Base.metadata 就認得全部資料表（Alembic 與 create_all 都靠它）。

領域：共用（改之前在群組講一聲）。每個檔案的主人寫在檔頭。
"""

from app.models.advice import Advice  # noqa: F401
from app.models.alert import AlertRule  # noqa: F401
from app.models.audit import AuditLog  # noqa: F401
from app.models.budget import Budget, SavingsGoal  # noqa: F401
from app.models.category import Category  # noqa: F401
from app.models.family import Family, FamilyMember, FamilyInvite  # noqa: F401
from app.models.group import Group, GroupMember, GroupInvite  # noqa: F401
from app.models.guardianship import Guardianship, Allowance  # noqa: F401
from app.models.nlp import NlpParse  # noqa: F401
from app.models.notification import Notification  # noqa: F401
from app.models.transaction import Account, Transaction  # noqa: F401
from app.models.user import User, UserSession, PasswordReset, EmailVerification  # noqa: F401
from app.models.memories import TransactionPhoto, PuzzleSettings, PuzzleGame, PuzzleEarning  # noqa: F401

__all__ = ["User", "UserSession", "PasswordReset", "EmailVerification", "Family", "FamilyMember", "FamilyInvite", "Guardianship", "Allowance", "Notification", "AuditLog", "Category", "Account", "Transaction", "NlpParse", "Group", "GroupMember", "Budget", "SavingsGoal", "AlertRule", "Advice"]

#: 表名 → 模型類別。crud 與測試用
TABLES = {"users": User, "sessions": UserSession, "password_resets": PasswordReset, "email_verifications": EmailVerification, "families": Family, "family_members": FamilyMember, "family_invites": FamilyInvite, "guardianships": Guardianship, "allowances": Allowance, "notifications": Notification, "audit_logs": AuditLog, "categories": Category, "accounts": Account, "transactions": Transaction, "nlp_parses": NlpParse, "groups": Group, "group_members": GroupMember, "budgets": Budget, "savings_goals": SavingsGoal, "alert_rules": AlertRule, "advices": Advice}
__all__ += ["TransactionPhoto", "PuzzleSettings", "PuzzleGame", "PuzzleEarning"]
TABLES.update({"transaction_photos": TransactionPhoto, "puzzle_settings": PuzzleSettings, "puzzle_games": PuzzleGame, "puzzle_earnings": PuzzleEarning})

from app.models.lifestyle import LifestylePreferences, HealthEntry, SmokingSettings, SmokingEntry, SavingsJar  # noqa: F401, E402

__all__ += ["LifestylePreferences", "HealthEntry", "SmokingSettings", "SmokingEntry", "SavingsJar"]
TABLES.update({"lifestyle_preferences": LifestylePreferences, "health_entries": HealthEntry, "smoking_settings": SmokingSettings, "smoking_entries": SmokingEntry, "savings_jars": SavingsJar})
__all__ += ["GroupInvite"]
TABLES["group_invites"] = GroupInvite
