# Customer Evaluation – CRM Score (v2)

نظام ويب **Frontend Only** لتقييم العملاء (مبيعات/مرتجعات/خصومات/سداد) مع:
- Score % + Stars + تصنيف
- **نِسب احترافية**:
  - نسبة السداد من المبيعات (%Payments / Sales)
  - نسبة المرتجعات من المبيعات (%Returns / Sales)
- **ملاحظات لكل عميل**
- بحث ذكي + اقتراحات
- Excel (استيراد/تصدير البيانات كاملة + عملاء فقط)
- PDF A4 احترافي (كشف حساب + تقارير)

---

## تسجيل الدخول
- admin / admin123

الأدوار:
- Admin
- Accountant
- Viewer

---

## تشغيل على GitHub Pages
ارفع الملفات:
- index.html
- app.css
- app.js
- README.md

ثم فعّل Pages من Settings → Pages.

---

## Firestore (اختياري)
بيانات الشركة → Firebase Config ثم اختبار الاتصال ثم مزامنة.

---

## Excel
- قالب جاهز: CRM_Score_Template.xlsx
- عملاء فقط: Customers_YYYY-MM-DD.xlsx (يدعم note)


## ✅ نسخة موبايل (PWA)
- هذه النسخة تعمل كتطبيق موبايل عند فتحها من الهاتف.
- يمكن تثبيتها على الشاشة الرئيسية (Add to Home Screen) وتعمل بوضع Standalone.
- تعمل بدون إنترنت بعد أول فتح (Offline Cache).

### تثبيت على Android
Chrome → ⋮ → Add to Home screen

### تثبيت على iPhone
Safari → Share → Add to Home Screen
