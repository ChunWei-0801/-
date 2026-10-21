"""Verification messages in the six supported interface languages.

領域：認證
"""

from html import escape

VERIFICATION_HOURS = 24

MESSAGES = {
    "zh-TW": ("驗證你的家庭記帳信箱", "請驗證你的家庭記帳電子信箱。", "驗證信箱", "連結在 {hours} 小時內有效，只能使用一次。若不是你申請的，請忽略此信。"),
    "zh-CN": ("验证你的家庭记账邮箱", "请验证你的家庭记账电子邮箱。", "验证邮箱", "链接在 {hours} 小时内有效，只能使用一次。如果不是你申请的，请忽略此邮件。"),
    "en": ("Verify your FamBudget email", "Please verify your email address for FamBudget.", "Verify email", "This link expires in {hours} hours and can only be used once. If you did not request this, ignore this email."),
    "ja": ("FamBudgetのメールアドレスを確認", "FamBudgetのメールアドレスを確認してください。", "メールアドレスを確認", "リンクは{hours}時間有効で、1回のみ使用できます。お心当たりのない場合は、このメールを無視してください。"),
    "ko": ("FamBudget 이메일 인증", "FamBudget에서 사용할 이메일 주소를 인증해 주세요.", "이메일 인증", "이 링크는 {hours}시간 동안 유효하며 한 번만 사용할 수 있습니다. 요청하지 않았다면 이 이메일을 무시해 주세요."),
    "es": ("Verifica tu correo de FamBudget", "Confirma tu dirección de correo electrónico para usar FamBudget.", "Verificar correo", "Este enlace caduca en {hours} horas y solo se puede usar una vez. Si no lo solicitaste, ignora este correo."),
}

FALLBACK = {
    "zh-TW": "若按鈕無法開啟，請複製以下網址至瀏覽器：",
    "zh-CN": "如果按钮无法打开，请复制以下网址到浏览器：",
    "en": "If the button does not open, copy this URL into your browser:",
    "ja": "ボタンが開かない場合は、次のURLをブラウザーにコピーしてください：",
    "ko": "버튼이 열리지 않으면 아래 주소를 브라우저에 복사해 주세요:",
    "es": "Si el botón no se abre, copia esta URL en tu navegador:",
}


def verification_message(name, link, language="zh-TW"):
    subject, intro, action, footer = MESSAGES.get(language, MESSAGES["en"])
    footer = footer.format(hours=VERIFICATION_HOURS)
    fallback = FALLBACK.get(language, FALLBACK["en"])
    url = escape(link, quote=True)
    text = f"{name}\n\n{intro}\n\n{fallback}\n{link}\n\n{footer}"
    html = (f'<div lang="{escape(language, quote=True)}" style="max-width:560px;margin:24px auto;padding:28px;'
            f'font-family:Arial,sans-serif;line-height:1.7;color:#23483c;background:#f7faf7;border-radius:16px">'
            f'<p>{escape(name)}</p><h1 style="font-size:22px;margin:16px 0">{escape(subject)}</h1>'
            f'<p>{escape(intro)}</p><p style="margin:28px 0">'
            f'<a href="{url}" style="display:inline-block;padding:14px 28px;background:#176b5d;'
            f'color:#ffffff;text-decoration:none;font-weight:bold;border-radius:10px">{escape(action)}</a></p>'
            f'<p style="font-size:14px">{escape(fallback)}</p>'
            f'<p style="font-size:13px;overflow-wrap:anywhere;word-break:break-all"><a href="{url}" '
            f'style="color:#176b5d">{escape(link)}</a></p>'
            f'<p style="font-size:13px;color:#526b60">{escape(footer)}</p></div>')
    return subject, text, html
