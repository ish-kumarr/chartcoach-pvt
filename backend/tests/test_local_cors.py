from fastapi.testclient import TestClient

from app.main import app


def test_local_loopback_frontend_is_allowed_by_cors():
    response = TestClient(app).options(
        "/auth/register",
        headers={
            "Origin": "http://127.0.0.1:3000",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:3000"
    assert response.headers["access-control-allow-credentials"] == "true"
