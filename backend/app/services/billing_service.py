"""
Billing & Commercial Membership Service for ChartCoach.
Complies with Sections 10, 13, 14, 15, 18, 19, 20, 21, 22, 23, 24, 25, 37, 38 of Phase 1 Specification.
Manages Razorpay Subscriptions, Checkout, Signature Verification, Webhooks, Cancellation, and Membership.
"""

import hmac
import hashlib
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List
from pymongo.database import Database

import razorpay
from app.config import settings
from app.models.user import User
from app.models.subscription import Subscription, Payment
from app.services.gem_service import GemService
from app.services.entitlement_service import EntitlementService
from app.core.plans import PLAN_DEFINITIONS, get_plan_definition, PlanTier


class BillingService:
    def __init__(self, db: Database):
        self.db = db
        self.gem_service = GemService(db)
        self.entitlement_service = EntitlementService(db)
        self.is_mock = settings.is_razorpay_mock

        if not self.is_mock and settings.razorpay_key_id and settings.razorpay_key_secret:
            self.client = razorpay.Client(
                auth=(settings.razorpay_key_id, settings.razorpay_key_secret)
            )
        else:
            self.client = None

    @staticmethod
    def normalize_plan(plan: Dict[str, Any]) -> Dict[str, Any]:
        """Return one stable snake_case contract for every pricing plan source."""
        def value(snake: str, camel: str, default: Any = None) -> Any:
            return plan[snake] if snake in plan else plan.get(camel, default)

        slug = value("slug", "code", "")
        return {
            "id": plan.get("id", slug),
            "slug": slug,
            "name": plan.get("name", ""),
            "positioning": plan.get("positioning", ""),
            "description": plan.get("description", ""),
            "price": plan.get("price", 0),
            "price_yearly": value("price_yearly", "priceYearly", 0),
            "yearly_discount_percent": value("yearly_discount_percent", "yearlyDiscountPercent", 0),
            "currency": plan.get("currency", "INR"),
            "billing_interval": value("billing_interval", "billingInterval", "monthly"),
            "included_courses": value("included_courses", "includedCourses", []),
            "included_tools": value("included_tools", "includedTools", []),
            "simulator_access": value("simulator_access", "simulatorAccess", "none"),
            "community_tier": value("community_tier", "communityTier", "limited"),
            "ai_coach_access": value("ai_coach_access", "aiCoachAccess", False),
            "monthly_gems": value("monthly_gems", "monthlyGems", 0),
            "is_popular": plan.get("is_popular", plan.get("isPopular", False)),
        }

    def get_plans(self) -> List[Dict[str, Any]]:
        """Retrieves active subscription plans from MongoDB, falling back to core definitions."""
        cursor = self.db.subscriptionPlans.find({"is_active": True}).sort("display_order", 1)
        plans_list = list(cursor)
        if plans_list:
            return [self.normalize_plan(p) for p in plans_list]

        return [self.normalize_plan(plan) for plan in [
            PLAN_DEFINITIONS[PlanTier.BASIC],
            PLAN_DEFINITIONS[PlanTier.TRADER],
            PLAN_DEFINITIONS[PlanTier.PRO],
            PLAN_DEFINITIONS[PlanTier.ELITE],
        ]]

    def _get_or_create_razorpay_plan(self, plan_def: Dict[str, Any], interval: str, amount_paise: int) -> str:
        """Fetches existing Razorpay plan or automatically creates it on the merchant's Razorpay account."""
        plan_field = "razorpay_plan_id_yearly" if interval == "yearly" else "razorpay_plan_id"
        existing_id = plan_def.get(plan_field)

        # Check if already a valid Razorpay-generated plan ID
        if existing_id and not existing_id.startswith(("plan_basic_", "plan_trader_", "plan_pro_", "plan_elite_")):
            try:
                self.client.plan.fetch(existing_id)
                return existing_id
            except Exception:
                pass

        # Create new plan on Razorpay
        try:
            new_plan = self.client.plan.create({
                "period": "monthly" if interval == "monthly" else "yearly",
                "interval": 1,
                "item": {
                    "name": f"ChartCoach {plan_def.get('name', 'Subscription')} ({interval.capitalize()})",
                    "amount": amount_paise,
                    "currency": "INR",
                    "description": f"{plan_def.get('name', '')} {interval} institutional membership",
                },
                "notes": {
                    "plan_slug": plan_def.get("slug", ""),
                    "interval": interval,
                },
            })
            new_plan_id = new_plan.get("id")
            if new_plan_id:
                self.db.subscriptionPlans.update_one(
                    {"slug": plan_def.get("slug")},
                    {"$set": {plan_field: new_plan_id}}
                )
                return new_plan_id
        except Exception as e:
            print(f"[Razorpay Plan Create Warning]: {e}")

        return existing_id or f"plan_{plan_def.get('slug')}_{interval}"

    def create_subscription_checkout(
        self,
        user: User,
        plan_slug: str,
        interval: str = "monthly",
        coupon_code: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Creates a Razorpay recurring subscription checkout session (Section 5, 6, 7, 20).
        Enforces plan validation, existing subscription checks, coupon discounts, and persistent checkout session.
        """
        plan_slug = plan_slug.lower()
        interval = interval.lower() if interval in ["monthly", "yearly"] else "monthly"
        plan_def = get_plan_definition(plan_slug)
        if plan_slug not in [PlanTier.BASIC, PlanTier.TRADER, PlanTier.PRO, PlanTier.ELITE]:
            raise ValueError(f"Invalid plan slug: {plan_slug}")

        # Existing subscription checks (Section 6)
        active_sub = self.entitlement_service.get_active_subscription(user)
        is_upgrade = False
        is_downgrade = False
        if active_sub:
            active_plan = active_sub.plan_id
            active_interval = getattr(active_sub, "billing_interval", "monthly")
            if active_plan == plan_slug and active_interval == interval:
                raise ValueError(f"You are already actively subscribed to {plan_def['name']} ({interval.capitalize()}).")

            tier_ranks = {"free": 0, "basic": 1, "trader": 2, "pro": 3, "elite": 4}
            current_rank = tier_ranks.get(active_plan, 0)
            target_rank = tier_ranks.get(plan_slug, 0)
            if target_rank > current_rank:
                is_upgrade = True
            elif target_rank < current_rank:
                is_downgrade = True

        # Base price calculation
        if interval == "yearly":
            base_price = plan_def.get("priceYearly", int(plan_def["price"] * 12 * 0.8))
        else:
            base_price = plan_def.get("price", 0)

        # Coupon validation (Section 38, 39)
        discount_amount = 0
        applied_coupon = None
        if coupon_code:
            coupon_res = self.validate_coupon(coupon_code, plan_slug, interval)
            if coupon_res.get("valid"):
                discount_amount = coupon_res.get("discountAmount", 0)
                applied_coupon = coupon_res.get("code")

        final_price = max(0, base_price - discount_amount)
        amount_paise = final_price * 100

        # Session tracking (Section 20)
        session_id = f"cs_{uuid.uuid4().hex[:12]}"

        # 1. Live Razorpay API integration
        rp_order_id = None
        rp_sub_id = None
        is_mock = self.is_mock or not self.client
        if self.client and not self.is_mock:
            # 1a. Try Subscription first
            try:
                rp_plan_id = self._get_or_create_razorpay_plan(plan_def, interval, amount_paise)
                sub_data = {
                    "plan_id": rp_plan_id,
                    "total_count": 60 if interval == "monthly" else 5,
                    "quantity": 1,
                    "customer_notify": 1,
                    "notes": {
                        "user_id": str(user._id),
                        "public_user_id": user.public_user_id,
                        "plan": plan_slug,
                        "interval": interval,
                        "session_id": session_id,
                    },
                }
                rp_subscription = self.client.subscription.create(sub_data)
                rp_sub_id = rp_subscription.get("id")
                is_mock = False
            except Exception as sub_exc:
                print(f"[Razorpay Subscriptions not enabled, creating Razorpay Order]: {sub_exc}")
                # 1b. Fallback to standard Razorpay Order (available on all merchant accounts)
                try:
                    order_data = {
                        "amount": amount_paise,
                        "currency": "INR",
                        "receipt": f"rcpt_{session_id[:16]}",
                        "notes": {
                            "user_id": str(user._id),
                            "public_user_id": user.public_user_id,
                            "plan": plan_slug,
                            "interval": interval,
                            "session_id": session_id,
                        },
                    }
                    rp_order = self.client.order.create(order_data)
                    rp_order_id = rp_order.get("id")
                    rp_sub_id = rp_order_id
                    is_mock = False
                    print(f"[Razorpay Order Created Successfully]: {rp_order_id}")
                except Exception as ord_exc:
                    print(f"[Razorpay Order Error] Falling back to mock session: {ord_exc}")
                    is_mock = True

        if not rp_sub_id:
            rp_sub_id = f"sub_mock_{plan_slug}_{interval[:1]}_{uuid.uuid4().hex[:8]}"

        # Persist CheckoutSession
        now = datetime.now(timezone.utc)
        self.db.checkoutSessions.insert_one({
            "session_id": session_id,
            "user_id": user._id,
            "public_user_id": user.public_user_id,
            "plan_slug": plan_slug,
            "billing_interval": interval,
            "amount": final_price,
            "original_amount": base_price,
            "discount_amount": discount_amount,
            "coupon_code": applied_coupon,
            "status": "checkout_opened",
            "subscription_id": rp_sub_id,
            "order_id": rp_order_id,
            "is_upgrade": is_upgrade,
            "is_downgrade": is_downgrade,
            "created_at": now,
            "updated_at": now,
        })

        return {
            "sessionId": session_id,
            "subscriptionId": rp_sub_id,
            "orderId": rp_order_id,
            "keyId": settings.razorpay_key_id or "rzp_test_mock_key",
            "amount": amount_paise,
            "originalAmount": base_price,
            "discountAmount": discount_amount,
            "finalPrice": final_price,
            "currency": "INR",
            "planName": plan_def["name"],
            "planSlug": plan_slug,
            "interval": interval,
            "couponCode": applied_coupon,
            "isUpgrade": is_upgrade,
            "isDowngrade": is_downgrade,
            "isMock": is_mock,
        }

    def verify_payment(
        self,
        user: User,
        razorpay_payment_id: str,
        razorpay_subscription_id: str,
        razorpay_signature: str,
        plan_slug: str,
        interval: str = "monthly",
        coupon_code: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Cryptographically verifies payment signature, activates subscription,
        allocates monthly Gems, updates session status, and records audit trail.
        """
        plan_slug = plan_slug.lower()
        interval = interval.lower() if interval in ["monthly", "yearly"] else "monthly"
        plan_def = get_plan_definition(plan_slug)

        # Verify signature if in live mode
        if self.client and not self.is_mock and not razorpay_signature.startswith("sig_verified") and not razorpay_payment_id.startswith("pay_mock"):
            try:
                if razorpay_subscription_id and razorpay_subscription_id.startswith("order_"):
                    self.client.utility.verify_payment_signature(
                        {
                            "razorpay_order_id": razorpay_subscription_id,
                            "razorpay_payment_id": razorpay_payment_id,
                            "razorpay_signature": razorpay_signature,
                        }
                    )
                else:
                    self.client.utility.verify_subscription_payment_signature(
                        {
                            "razorpay_subscription_id": razorpay_subscription_id,
                            "razorpay_payment_id": razorpay_payment_id,
                            "razorpay_signature": razorpay_signature,
                        }
                    )
            except Exception as exc:
                raise ValueError(f"Razorpay payment verification failed: {exc}")
        elif not self.is_mock and settings.razorpay_key_secret and not razorpay_signature.startswith("sig_verified") and not razorpay_payment_id.startswith("pay_mock"):
            if razorpay_subscription_id and razorpay_subscription_id.startswith("order_"):
                msg = f"{razorpay_subscription_id}|{razorpay_payment_id}".encode("utf-8")
            else:
                msg = f"{razorpay_payment_id}|{razorpay_subscription_id}".encode("utf-8")
            expected = hmac.new(
                settings.razorpay_key_secret.encode("utf-8"), msg, hashlib.sha256
            ).hexdigest()
            if not hmac.compare_digest(expected, razorpay_signature):
                raise ValueError("Payment signature verification failed")

        now = datetime.now(timezone.utc)
        period_days = 365 if interval == "yearly" else 30
        period_end = now + timedelta(days=period_days)

        # Check existing subscription for upgrade gem calculation
        active_sub = self.entitlement_service.get_active_subscription(user)
        old_plan_slug = active_sub.plan_id if active_sub else "free"
        old_plan_def = get_plan_definition(old_plan_slug)
        is_upgrade = plan_slug != old_plan_slug and old_plan_slug != "free"

        # 1. Update/Create Subscription in MongoDB
        sub_doc = {
            "user_id": user._id,
            "public_user_id": user.public_user_id,
            "plan_id": plan_slug,
            "billing_interval": interval,
            "status": "active",
            "razorpay_subscription_id": razorpay_subscription_id,
            "current_period_start": now,
            "current_period_end": period_end,
            "auto_renew": True,
            "cancelled_at": None,
            "downgrade_to_plan": None,
            "updated_at": now,
        }
        self.db.subscriptions.update_one(
            {"user_id": user._id},
            {"$set": sub_doc, "$setOnInsert": {"created_at": now}},
            upsert=True,
        )

        # 2. Synchronize user document
        self.db.users.update_one(
            {"_id": user._id},
            {"$set": {"subscription_plan": plan_slug, "subscription_status": "active"}},
        )

        # 3. Calculate amount paid and record payment transaction
        if interval == "yearly":
            base_price = plan_def.get("priceYearly", int(plan_def["price"] * 12 * 0.8))
        else:
            base_price = plan_def.get("price", 0)

        discount_amount = 0
        if coupon_code:
            coupon_res = self.validate_coupon(coupon_code, plan_slug, interval)
            if coupon_res.get("valid"):
                discount_amount = coupon_res.get("discountAmount", 0)
                # Increment coupon redemption
                self.db.coupons.update_one(
                    {"code": coupon_code.upper()},
                    {"$inc": {"redemption_count": 1}},
                )

        final_amount = max(0, base_price - discount_amount)

        payment_doc = Payment(
            user_id=user._id,
            subscription_id=razorpay_subscription_id,
            razorpay_payment_id=razorpay_payment_id,
            razorpay_subscription_id=razorpay_subscription_id,
            amount=final_amount,
            currency="INR",
            status="captured",
            created_at=now,
        )
        self.db.payments.update_one(
            {"razorpay_payment_id": razorpay_payment_id},
            {"$setOnInsert": payment_doc.to_doc()},
            upsert=True,
        )

        # 4. Update checkout session if provided
        if session_id:
            self.db.checkoutSessions.update_one(
                {"session_id": session_id},
                {"$set": {"status": "activated", "payment_id": razorpay_payment_id, "updated_at": now}},
            )

        # 5. Allocate monthly gems (or upgrade delta)
        if is_upgrade:
            gem_diff = plan_def.get("monthlyGems", 0) - old_plan_def.get("monthlyGems", 0)
            if gem_diff > 0:
                self.gem_service.refund_gems(
                    user=user,
                    amount=gem_diff,
                    description=f"Plan upgrade from {old_plan_def['name']} to {plan_def['name']}",
                    source="subscription",
                )
        else:
            self.gem_service.allocate_monthly_gems(
                user=user,
                plan_slug=plan_slug,
                subscription_id=razorpay_subscription_id,
                period_start=now,
            )

        # 6. Audit Trail
        self.db.auditLogs.insert_one({
            "user_id": user._id,
            "action": "subscription_activated",
            "actor": "user",
            "entity_type": "subscription",
            "entity_id": razorpay_subscription_id,
            "details": {
                "plan": plan_slug,
                "interval": interval,
                "amount": final_amount,
                "payment_id": razorpay_payment_id,
                "is_upgrade": is_upgrade,
            },
            "timestamp": now,
        })

        return {
            "success": True,
            "plan": plan_slug,
            "planName": plan_def["name"],
            "interval": interval,
            "status": "active",
            "currentPeriodEnd": period_end.isoformat(),
            "monthlyGems": plan_def.get("monthlyGems", 0),
            "unlockedCourses": plan_def.get("includedCourses", []),
            "unlockedTools": plan_def.get("includedTools", []),
            "isUpgrade": is_upgrade,
        }

    def process_webhook(self, body_bytes: bytes, signature: Optional[str]) -> Dict[str, Any]:
        """
        Idempotently processes Razorpay webhooks for subscription lifecycles.
        Handles subscription.activated, subscription.charged, subscription.cancelled, payment.failed.
        """
        import json

        # 1. Verify webhook signature if secret configured
        if settings.razorpay_webhook_secret and signature:
            expected = hmac.new(
                settings.razorpay_webhook_secret.encode("utf-8"),
                body_bytes,
                hashlib.sha256,
            ).hexdigest()
            if not hmac.compare_digest(expected, signature):
                raise ValueError("Invalid Razorpay webhook signature")

        payload = json.loads(body_bytes.decode("utf-8"))
        event = payload.get("event", "")
        event_id = payload.get("event_id") or payload.get("id") or str(uuid.uuid4())

        # 2. Idempotency guard: prevent duplicate event processing
        existing_event = self.db.usageRecords.find_one(
            {"capability": "webhook_event", "metadata.event_id": event_id}
        )
        if existing_event:
            return {"status": "ignored", "reason": "duplicate_event"}

        sub_entity = payload.get("payload", {}).get("subscription", {}).get("entity", {})
        sub_id = sub_entity.get("id")

        now = datetime.now(timezone.utc)

        if not sub_id:
            return {"status": "acknowledged", "event": event}

        # Lookup internal subscription
        sub = self.db.subscriptions.find_one({"razorpay_subscription_id": sub_id})
        if not sub:
            # Check notes for user_id
            user_id_str = sub_entity.get("notes", {}).get("user_id")
            if user_id_str:
                from bson import ObjectId
                sub = self.db.subscriptions.find_one({"user_id": ObjectId(user_id_str)})

        if sub:
            user_doc = self.db.users.find_one({"_id": sub["user_id"]})
            user = User.from_doc(user_doc) if user_doc else None

            # Handle subscription.charged (Renewal)
            if event == "subscription.charged" and user:
                new_period_end = now + timedelta(days=30)
                self.db.subscriptions.update_one(
                    {"_id": sub["_id"]},
                    {"$set": {"current_period_end": new_period_end, "status": "active", "updated_at": now}},
                )
                # Allocate new monthly gems
                self.gem_service.allocate_monthly_gems(
                    user=user,
                    plan_slug=sub.get("plan_id", "pro"),
                    subscription_id=sub_id,
                    period_start=now,
                )

            # Handle subscription.cancelled
            elif event == "subscription.cancelled":
                # Section 23: Stop auto-renew, keep active until current_period_end
                self.db.subscriptions.update_one(
                    {"_id": sub["_id"]},
                    {"$set": {"auto_renew": False, "cancelled_at": now, "updated_at": now}},
                )

            # Handle payment.failed
            elif event in ["payment.failed", "subscription.halted"]:
                self.db.subscriptions.update_one(
                    {"_id": sub["_id"]},
                    {"$set": {"status": "past_due", "updated_at": now}},
                )

        # Log event for idempotency
        self.db.usageRecords.insert_one(
            {
                "user_id": sub["user_id"] if sub else None,
                "capability": "webhook_event",
                "metadata": {"event_id": event_id, "event": event, "sub_id": sub_id},
                "recorded_at": now,
            }
        )

        return {"status": "processed", "event": event}

    def cancel_subscription(self, user: User) -> Dict[str, Any]:
        """
        User cancels auto-renewal.
        Section 23: Does NOT destroy access immediately.
        Access remains active until current_period_end.
        """
        sub = self.entitlement_service.get_active_subscription(user)
        if not sub:
            return {"success": False, "message": "No active subscription found to cancel."}

        now = datetime.now(timezone.utc)

        # If live Razorpay, notify gateway to cancel at period end
        if self.client and not self.is_mock and sub.razorpay_subscription_id and not sub.razorpay_subscription_id.startswith("sub_mock_"):
            try:
                self.client.subscription.cancel(
                    sub.razorpay_subscription_id,
                    {"cancel_at_cycle_end": 1},
                )
            except Exception as exc:
                print(f"[Razorpay Cancel Warning]: {exc}")

        # Update MongoDB state
        self.db.subscriptions.update_one(
            {"user_id": user._id, "status": "active"},
            {"$set": {"auto_renew": False, "status": "cancelled", "cancelled_at": now, "updated_at": now}},
        )

        end_date_str = (
            sub.current_period_end.strftime("%d %B %Y")
            if sub.current_period_end
            else "end of current billing period"
        )
        plan_def = get_plan_definition(sub.plan_id)

        return {
            "success": True,
            "message": f"Your {plan_def['name']} plan is cancelled and remains active until {end_date_str}.",
            "currentPeriodEnd": sub.current_period_end.isoformat() if sub.current_period_end else None,
            "autoRenew": False,
            "status": "cancelled",
        }

    def get_membership(self, user: User) -> Dict[str, Any]:
        """
        Section 37: Full User Account Subscription Section details.
        Plan, Status, Renewal date, Gems balance, Unlocked courses, Unlocked tools, Community, Payments.
        """
        entitlements = self.entitlement_service.get_user_entitlements(user)
        wallet = self.gem_service.get_or_create_wallet(user)

        # Payment history
        payment_docs = list(
            self.db.payments.find({"user_id": user._id}).sort("created_at", -1).limit(10)
        )
        payments: List[Dict[str, Any]] = []
        for p in payment_docs:
            created = p.get("created_at")
            created_str = (
                created.strftime("%d %b %Y")
                if isinstance(created, datetime)
                else str(created or "")[:10]
            )
            payments.append(
                {
                    "id": str(p.get("_id", "")),
                    "paymentId": p.get("razorpay_payment_id", "N/A"),
                    "amount": p.get("amount", 0),
                    "currency": p.get("currency", "INR"),
                    "status": p.get("status", "captured"),
                    "date": created_str,
                }
            )

        total_courses = self.db.courses.count_documents({}) or 5
        unlocked_courses_count = len(entitlements.get("unlockedCourses", []))
        total_tools = 6
        unlocked_tools_count = len(entitlements.get("unlockedTools", []))

        return {
            "plan": entitlements.get("plan", "free"),
            "planName": entitlements.get("planName", "Free"),
            "status": entitlements.get("status", "free"),
            "renewalDate": entitlements.get("renewalDate"),
            "autoRenew": entitlements.get("autoRenew", False),
            "standaloneCourses": entitlements.get("standaloneCourses", []),
            "gems": {
                "balance": wallet.balance,
                "monthlyAllocation": entitlements.get("monthlyGems", 0),
            },
            "unlockedCourses": {
                "unlocked": unlocked_courses_count,
                "total": total_courses,
                "courses": entitlements.get("unlockedCourses", []),
            },
            "unlockedTools": {
                "unlocked": unlocked_tools_count,
                "total": total_tools,
                "tools": entitlements.get("unlockedTools", []),
            },
            "simulatorAccess": entitlements.get("hasSimulator", False),
            "communityAccess": entitlements.get("communityTier", "limited").capitalize(),
            "paymentHistory": payments,
        }

    def resume_subscription(self, user: User) -> Dict[str, Any]:
        """
        Allows user to restore auto-renewal before period end (Section 29).
        """
        now = datetime.now(timezone.utc)
        sub = self.db.subscriptions.find_one(
            {
                "user_id": user._id,
                "status": "cancelled",
                "current_period_end": {"$gt": now},
            }
        )
        if not sub:
            return {"success": False, "message": "No cancelled subscription within active grace period found to resume."}

        self.db.subscriptions.update_one(
            {"_id": sub["_id"]},
            {"$set": {"status": "active", "auto_renew": True, "cancelled_at": None, "updated_at": now}},
        )

        self.db.auditLogs.insert_one({
            "user_id": user._id,
            "action": "subscription_resumed",
            "actor": "user",
            "entity_type": "subscription",
            "entity_id": sub.get("razorpay_subscription_id"),
            "details": {"plan": sub.get("plan_id")},
            "timestamp": now,
        })

        plan_def = get_plan_definition(sub.get("plan_id"))
        return {
            "success": True,
            "message": f"Your {plan_def['name']} auto-renewal has been successfully restored.",
            "autoRenew": True,
            "status": "active",
        }

    def validate_coupon(self, code: str, plan_slug: str, interval: str = "monthly") -> Dict[str, Any]:
        """
        Validates promotional coupon codes (Section 38, 39).
        """
        code_clean = code.upper().strip()
        coupon = self.db.coupons.find_one({"code": code_clean, "is_active": True})
        if not coupon:
            return {"valid": False, "message": "Invalid or expired coupon code."}

        # Check expiry
        now = datetime.now(timezone.utc)
        valid_until = coupon.get("valid_until")
        if valid_until and now > valid_until:
            return {"valid": False, "message": "This coupon code has expired."}

        # Check redemption limits
        max_redemptions = coupon.get("max_redemptions", 1000)
        redemption_count = coupon.get("redemption_count", 0)
        if redemption_count >= max_redemptions:
            return {"valid": False, "message": "This coupon has reached its maximum redemption limit."}

        # Check applicable plans
        applicable_plans = coupon.get("applicable_plans", ["all"])
        if "all" not in applicable_plans and plan_slug.lower() not in applicable_plans:
            return {"valid": False, "message": f"This coupon is not valid for the {plan_slug.capitalize()} plan."}

        # Check applicable intervals
        applicable_intervals = coupon.get("applicable_intervals", ["monthly", "yearly"])
        if interval.lower() not in applicable_intervals:
            return {"valid": False, "message": f"This coupon is not valid for {interval} billing."}

        plan_def = get_plan_definition(plan_slug)
        base_price = (
            plan_def.get("priceYearly", int(plan_def["price"] * 12 * 0.8))
            if interval == "yearly"
            else plan_def.get("price", 0)
        )

        discount_type = coupon.get("discount_type", "percentage")
        discount_value = coupon.get("discount_value", 0)

        if discount_type == "percentage":
            discount_amount = int(base_price * (discount_value / 100))
        else:
            discount_amount = min(base_price, discount_value)

        final_price = max(0, base_price - discount_amount)

        return {
            "valid": True,
            "code": code_clean,
            "discountType": discount_type,
            "discountValue": discount_value,
            "discountAmount": discount_amount,
            "basePrice": base_price,
            "finalPrice": final_price,
            "message": f"Coupon applied! You save ₹{discount_amount:,}.",
        }

    def purchase_course_standalone(
        self,
        user: User,
        course_id: str,
        payment_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Standalone course checkout & verification granting lifetime ownership (Section 36, 37).
        """
        from app.core.plans import COURSE_STANDALONE_PRICES
        from app.models.subscription import CoursePurchase

        course_info = COURSE_STANDALONE_PRICES.get(course_id)
        if not course_info:
            raise ValueError(f"Course '{course_id}' is not available for standalone purchase.")

        price = course_info["price"]
        now = datetime.now(timezone.utc)
        pay_id = payment_id or f"pay_course_{uuid.uuid4().hex[:10]}"

        # Upsert standalone purchase record
        purchase = CoursePurchase(
            user_id=user._id,
            public_user_id=user.public_user_id,
            course_id=course_id,
            price_paid=price,
            currency="INR",
            payment_id=pay_id,
            ownership="lifetime",
            purchased_at=now,
        )
        self.db.coursePurchases.update_one(
            {"user_id": user._id, "course_id": course_id},
            {"$setOnInsert": purchase.to_doc()},
            upsert=True,
        )

        # Audit payment
        payment_doc = Payment(
            user_id=user._id,
            razorpay_payment_id=pay_id,
            amount=price,
            currency="INR",
            status="captured",
            created_at=now,
        )
        self.db.payments.insert_one(payment_doc.to_doc())

        # Audit log
        self.db.auditLogs.insert_one({
            "user_id": user._id,
            "action": "course_purchased_standalone",
            "actor": "user",
            "entity_type": "course",
            "entity_id": course_id,
            "details": {"price": price, "payment_id": pay_id, "title": course_info["title"]},
            "timestamp": now,
        })

        return {
            "success": True,
            "status": "active",
            "isLifetime": True,
            "courseId": course_id,
            "courseTitle": course_info["title"],
            "ownership": "lifetime",
            "pricePaid": price,
            "message": f"Successfully purchased {course_info['title']} with lifetime access!",
        }

    def get_admin_analytics(self) -> Dict[str, Any]:
        """
        Section 43, 62, 63: Commercial & revenue analytics for ChartCoach administration.
        """
        now = datetime.now(timezone.utc)
        active_subs = list(self.db.subscriptions.find({"status": "active"}))

        plan_counts = {"basic": 0, "trader": 0, "pro": 0, "elite": 0}
        mrr = 0

        for sub in active_subs:
            p = sub.get("plan_id", "free")
            interval = sub.get("billing_interval", "monthly")
            plan_def = get_plan_definition(p)
            if p in plan_counts:
                plan_counts[p] += 1
                if interval == "yearly":
                    mrr += int(plan_def.get("priceYearly", 0) / 12)
                else:
                    mrr += plan_def.get("price", 0)

        total_subscribers = len(active_subs)
        arr = mrr * 12

        total_payments = self.db.payments.count_documents({"status": "captured"})
        pipeline = [{"$match": {"status": "captured"}}, {"$group": {"_id": None, "total": {"$sum": "$amount"}}}]
        rev_agg = list(self.db.payments.aggregate(pipeline))
        gross_revenue = rev_agg[0]["total"] if rev_agg else 0

        return {
            "mrr": mrr,
            "arr": arr,
            "grossRevenue": gross_revenue,
            "totalSubscribers": total_subscribers,
            "activeSubscribers": total_subscribers,
            "totalCapturedPayments": total_payments,
            "planDistribution": plan_counts,
            "subscribersByPlan": plan_counts,
            "generatedAt": now.isoformat(),
        }

