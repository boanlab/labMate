"""메일 서버 설정(관리자 편집) — 계정 정보는 여기 두지 않는다.

호스트·포트처럼 연구실이 공통으로 쓰는 값만 둔다. 사람마다 다른 주소·비밀번호는
mail_accounts 에 각자 넣는다(비밀번호는 암호화).
"""
from __future__ import annotations

DEFAULTS: dict = {
    "mail_enabled": False,          # 꺼 두면 사이드바에 '전자메일'이 뜨지 않는다
    "mail_imap_host": "",
    "mail_imap_port": 993,
    "mail_imap_ssl": True,          # False 면 143 + STARTTLS
    "mail_smtp_host": "",
    "mail_smtp_port": 587,
    "mail_smtp_tls": "starttls",    # starttls | ssl | none
    "mail_domain": "",              # 계정 추가 때 보여 줄 기본 도메인(예: boanlab.com)
    "mail_list_size": 30,           # 목록 한 번에 가져올 통수
}
