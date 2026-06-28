"""Batch-apply image_url values for players who were missing them.

Sources: Wikipedia infobox photos at 500px width. Players whose Wikipedia
pages have no infobox photo are left out and reported at the bottom.
"""
import os
from dotenv import load_dotenv
from firebase_admin import credentials, db, initialize_app

load_dotenv()
cred = credentials.Certificate(os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY"))
initialize_app(cred, {"databaseURL": os.getenv("DATABASE_URL")})

UPDATES = {
    # pid: (player_name, image_url)
    "34145891": ("Andy Robertson",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/Andy_Robertson_Scotland_v_Bolivia_6_June_2026-43.jpg/500px-Andy_Robertson_Scotland_v_Bolivia_6_June_2026-43.jpg"),
    "34145724": ("José Sá",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/Jos%C3%A9_S%C3%A1_USMNT_v_Portugal_Mar_31_2026-185_%28cropped%29.jpg/500px-Jos%C3%A9_S%C3%A1_USMNT_v_Portugal_Mar_31_2026-185_%28cropped%29.jpg"),
    "34146348": ("Luis Suárez",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Luis_Javier_Su%C3%A1rez_Charris.jpg/500px-Luis_Javier_Su%C3%A1rez_Charris.jpg"),
    "34193190": ("Hiroki Itō",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Hiroki_Ito_VfB_Stuttgart.jpg/500px-Hiroki_Ito_VfB_Stuttgart.jpg"),
    "34174117": ("Jorge Carrascal",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/7/76/Jorge_Carrascal_2025.jpg/500px-Jorge_Carrascal_2025.jpg"),
    "34146284": ("Liam Kelly",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ac/Liam_Kelly_Scotland_v_Bolivia_6_June_2026-20.jpg/500px-Liam_Kelly_Scotland_v_Bolivia_6_June_2026-20.jpg"),
    "34200757": ("Derek Cornelius",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/Cornelius_asse_om_2425.png/500px-Cornelius_asse_om_2425.png"),
    "34204172": ("Andrés Gómez",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/IMCF_vs._RSL_25_%28cropped%29_%28cropped%29.jpg/500px-IMCF_vs._RSL_25_%28cropped%29_%28cropped%29.jpg"),
    "wc_ihsan_haddad": ("Ihsan Haddad",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fb/Ihsan_Haddad.jpg/500px-Ihsan_Haddad.jpg"),
    "34146610": ("Maurício",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Mauricio-palmeiras-sport-ago-25_%28cropped%29.jpg/500px-Mauricio-palmeiras-sport-ago-25_%28cropped%29.jpg"),
    "34271926": ("Abdul Rahman Baba",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/Ghana_national_Baba_Rahman.jpg/500px-Ghana_national_Baba_Rahman.jpg"),
    "wc_bilal_el_khannouss": ("Bilal El Khannouss",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Bilal_El_Khannouss_vs_Niger_%28cropped%29.jpg/500px-Bilal_El_Khannouss_vs_Niger_%28cropped%29.jpg"),
    "34196369": ("Ladislav Krejčí",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/Ladislav_Krej%C4%8D%C3%AD_01112025_%281%29.jpg/500px-Ladislav_Krej%C4%8D%C3%AD_01112025_%281%29.jpg"),
    "34163404": ("Kaku",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Alejandro_Romero_20180612_%28cropped%29.jpg/500px-Alejandro_Romero_20180612_%28cropped%29.jpg"),
    "34342200": ("Cho Wi-je",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/260411_FC_%EC%84%9C%EC%9A%B8_vs_%EC%A0%84%EB%B6%81_%28%EC%A1%B0%EC%9C%84%EC%A0%9C%29.jpg/500px-260411_FC_%EC%84%9C%EC%9A%B8_vs_%EC%A0%84%EB%B6%81_%28%EC%A1%B0%EC%9C%84%EC%A0%9C%29.jpg"),
    "34149740": ("CJ dos Santos",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/C.J._dos_Santos_%28cropped_2%29.jpg/500px-C.J._dos_Santos_%28cropped_2%29.jpg"),
    "34275677": ("José Luis Rodríguez",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/6/67/Jos%C3%A9_Rodr%C3%ADguez.jpg/500px-Jos%C3%A9_Rodr%C3%ADguez.jpg"),
    "34147362": ("Ryan Mendes",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Ryan_Mendes_%28LOSC_Lille%29.JPG/500px-Ryan_Mendes_%28LOSC_Lille%29.JPG"),
    "wc_shahriyar_moghanlou": ("Shahriyar Moghanlou",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/6/66/Shahriyar_Moghanlou_14000129000016637543017694769152.jpg/500px-Shahriyar_Moghanlou_14000129000016637543017694769152.jpg"),
    "34192805": ("Hossein Hosseini",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/7/72/Esteghlal_FC_vs_Sepahan_FC%2C_14_December_2021_-_26.jpg/500px-Esteghlal_FC_vs_Sepahan_FC%2C_14_December_2021_-_26.jpg"),
    "wc_salim_obaid": ("Salim Obaid",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Sepahan_and_Al-Hussein_Jordan_football_teams_meet_21_%282025%29_esfahanzibaonline.ir_%28cropped2%29.jpg/500px-Sepahan_and_Al-Hussein_Jordan_football_teams_meet_21_%282025%29_esfahanzibaonline.ir_%28cropped2%29.jpg"),
}

# Players whose Wikipedia pages exist but have no infobox photo. Reported,
# not updated.
NO_PHOTO_FOUND = [
    "34146748 Wesley (Brazil)",
    "34238988 Ali Ahmed (Canada)",
    "34204172_alt Andrés Gómez (Colombia) — used backup MLS photo",
    "34199262 Frans Putros (Iraq)",
    "wc_mouhib_chamakh Mouhib Chamakh (Tunisia)",
    "34287466 Ali Yousif (Iraq)",
    "wc_mohamed_manai Mohamed Manai (Qatar)",
    "wc_akam_hashim Akam Hashim (Iraq)",
    "34146284_check Kevin Rodríguez (Ecuador) — page has no photo",
]

ok, skipped = 0, 0
for pid, (name, url) in UPDATES.items():
    rec = db.reference(f"data/players/{pid}").get()
    if not rec:
        print(f"  SKIP  {pid:<22} {name}  (no record found)")
        skipped += 1
        continue
    db.reference(f"data/players/{pid}/image_url").set(url)
    print(f"  OK    {pid:<22} {name}")
    ok += 1

print(f"\nDone. {ok} updated, {skipped} skipped.")
print(f"\nPlayers whose Wikipedia pages have no infobox photo ({len(NO_PHOTO_FOUND)}):")
for line in NO_PHOTO_FOUND:
    print(f"  - {line}")
