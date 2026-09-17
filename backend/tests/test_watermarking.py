from app.services.watermarking import build_watermark_identity, mask_email


def test_mask_email_keeps_domain_without_exposing_full_local_part():
    assert mask_email("learner@example.com") == "l••••••@example.com"


def test_watermark_identity_is_session_bound_and_does_not_return_raw_email():
    first = build_watermark_identity("learner@example.com", "session-a", "secret")
    second = build_watermark_identity("learner@example.com", "session-b", "secret")
    assert first["visible_text"] == "l••••••@example.com"
    assert first["forensic_id"] != second["forensic_id"]
    assert "learner@example.com" not in repr(first)
    assert first["algorithm"] == "hmac-sha256-session-bound"
