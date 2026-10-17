"""Verification messages in the six supported interface languages.

領域：認證
"""

from html import escape

MESSAGES = {
    "zh-TW": ("驗證你的家庭記帳信箱", "請驗證你的家庭記帳電子信箱。", "驗證信箱", "連結在 30 分鐘內有效，只能使用一次。若不是你申請的，請忽略此信。"),
    "zh-CN": ("验证你的家庭记账邮箱", "请验证你的家庭记账电子邮箱。", "验证邮箱", "链接在 30 分钟内有效，只能使用一次。如果不是你申请的，请忽略此邮件。"),
    "en": ("Verify your FamBudget email", "Please verify your email address for FamBudget.", "Verify email", "This link expires in 30 minutes and can only be used once. If you did not request this, ignore this email."),
    "ja": ("FamBudgetのメールアドレスを確認", "FamBudgetのメールアドレスを確認してください。", "メールアドレスを確認", "リンクは30分間有効で、1回のみ使用できます。お心当たりのない場合は、このメールを無視してください。"),
    "ko": ("FamBudget 이메일 인증", "FamBudget에서 사용할 이메일 주소를 인증해 주세요.", "이메일 인증", "이 링크는 30분 동안 유효하며 한 번만 사용할 수 있습니다. 요청하지 않았다면 이 이메일을 무시해 주세요."),
    "es": ("Verifica tu correo de FamBudget", "Confirma tu dirección de correo electrónico para usar FamBudget.", "Verificar correo", "Este enlace caduca en 30 minutos y solo se puede usar una vez. Si no lo solicitaste, ignora este correo."),
}


def verification_message(name, link, language="zh-TW"):
    subject, intro, action, footer = MESSAGES.get(language, MESSAGES["en"])
    text = f"{name}\n\n{intro}\n\n{link}\n\n{footer}"
    html = (f'<div lang="{escape(language, quote=True)}"><p>{escape(name)}</p>'
            f'<p>{escape(intro)}</p><p><a href="{escape(link, quote=True)}">{escape(action)}</a></p>'
            f'<p>{escape(footer)}</p></div>')
    return subject, text, html
