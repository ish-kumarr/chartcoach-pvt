import pytest

import scripts.media as media


build_parser = media.build_parser


def test_media_cli_supports_import_status_and_retry_commands():
    parser = build_parser()
    assert parser.parse_args(["import", "lecture.mp4"]).command == "import"
    assert parser.parse_args(["status", "asset-1"]).asset_id == "asset-1"
    assert parser.parse_args(["retry", "job-1"]).job_id == "job-1"
    assert parser.parse_args(["worker", "--once"]).once is True
    package = parser.parse_args(["package", "asset-1", "--generation", "g1"])
    assert (package.asset_id, package.generation) == ("asset-1", "g1")
    encrypted = parser.parse_args(["package", "asset-1", "--generation", "g2", "--encrypt"])
    assert encrypted.encrypt is True
    watermarked = parser.parse_args(
        [
            "package",
            "asset-1",
            "--generation",
            "g3",
            "--encrypt",
            "--watermark-email-file",
            "learner-email.txt",
            "--watermark-session",
            "session-1",
        ]
    )
    assert watermarked.watermark_email_file == "learner-email.txt"
    assert watermarked.watermark_session == "session-1"
    caption = parser.parse_args(["caption", "asset-1", "captions.srt", "--language", "hi", "--label", "Hindi"])
    assert (caption.asset_id, caption.language, caption.label) == ("asset-1", "hi", "Hindi")


def test_cli_watermark_identity_reads_email_from_file_without_returning_raw_email(tmp_path):
    email_file = tmp_path / "learner-email.txt"
    email_file.write_text("learner@example.com\n", encoding="utf-8")

    identity = media.load_watermark_identity(
        email_file=email_file,
        playback_session_id="session-1",
        secret="watermark-secret",
        environment="development",
    )

    assert identity["visible_text"] == "l••••••@example.com"
    assert "learner@example.com" not in repr(identity)
    assert "watermark-secret" not in repr(identity)


def test_cli_watermark_identity_fails_closed_in_production_when_missing():
    with pytest.raises(RuntimeError, match="Production packaging requires"):
        media.load_watermark_identity(
            email_file=None,
            playback_session_id=None,
            secret=None,
            environment="production",
        )
