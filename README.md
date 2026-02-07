# Customer Evaluation – CRM Score
واجهة ويب خفيفة (Frontend فقط) + Firebase Firestore.
## تشغيل
- ارفع الملفات على GitHub Pages (Static)
- عدّل `firebaseConfig` داخل `firebase.js`
- فعّل Firestore من Firebase Console
## Excel
Sheets المطلوبة: customers, sales, returns, payments, discounts
## طباعة / PDF
من صفحة العميل: زر (طباعة / PDF) — A4


## المستخدمون (Auth)
- تم إضافة Firebase Authentication (Email/Password)
- عند إنشاء حساب جديد يتم إنشاء مستند في `users/{uid}` بصلاحية Viewer.
- لتحويل المستخدم إلى Admin: Firestore → users → {uid} → role = Admin
