"""When a payment reminder goes out, and what it says. Pure functions — no server or DB."""
from datetime import date

from payment_reminders import build_reminder_email, reminder_milestone

TODAY = date(2026, 9, 15)


def _due_in(days: int) -> str:
    return date.fromordinal(TODAY.toordinal() + days).isoformat()


def test_points_and_their_catch_up_windows():
    expected = {
        4: None,
        3: 3, 2: 3, 1: 3,
        0: 0, -1: 0, -2: 0,
        -3: -3, -5: -3,
        -6: -6, -8: -6,
        -9: -9, -11: -9,
        -12: None, -200: None,
    }
    for days, point in expected.items():
        assert reminder_milestone(_due_in(days), TODAY) == point, days


def test_bad_due_date_is_ignored():
    assert reminder_milestone("", TODAY) is None
    assert reminder_milestone("not-a-date", TODAY) is None


def test_email_lists_every_installment_and_the_balance():
    rows = [
        ("treatment", 2, 3, {"amount": 5000, "due_date": _due_in(-3)}),
        ("diet", 1, 1, {"amount": 1500.5, "due_date": _due_in(3)}),
    ]
    subject, body = build_reminder_email(
        {"name": "Asha"}, rows, 12000, TODAY, {"branch_name": "Anna Nagar", "phone": "9876543210"},
    )
    assert subject == "Payment overdue — FITSIOMAX"
    assert "Hi Asha," in body
    assert "Treatment Fee — installment 2 of 3: Rs.5,000, overdue" in body
    assert "Diet Consultation Fee: Rs.1,500.50, due on 18 Sep 2026 (in 3 days)" in body
    assert "Total balance outstanding: Rs.12,000" in body
    assert "call Anna Nagar on 9876543210" in body


def test_subject_for_due_today_and_upcoming():
    today_row = [("treatment", 1, 2, {"amount": 100, "due_date": _due_in(0)})]
    assert build_reminder_email({}, today_row, 100, TODAY)[0] == "Payment due today — FITSIOMAX"
    soon_row = [("treatment", 1, 2, {"amount": 100, "due_date": _due_in(3)})]
    assert build_reminder_email({}, soon_row, 100, TODAY)[0] == "Payment reminder — due 18 Sep 2026 — FITSIOMAX"
