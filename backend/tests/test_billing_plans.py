from app.services.billing_service import BillingService


def test_normalize_plan_exposes_pricing_contract_in_snake_case():
    plan = BillingService.normalize_plan(
        {
            "code": "pro",
            "name": "Pro",
            "monthlyGems": 1500,
            "priceYearly": 30000,
            "yearlyDiscountPercent": 20,
            "includedCourses": ["trading-101"],
            "includedTools": ["paper-trading"],
            "simulatorAccess": "full",
            "communityTier": "full",
            "aiCoachAccess": True,
        }
    )

    assert plan["slug"] == "pro"
    assert plan["monthly_gems"] == 1500
    assert plan["price_yearly"] == 30000
    assert plan["included_courses"] == ["trading-101"]
    assert plan["ai_coach_access"] is True
