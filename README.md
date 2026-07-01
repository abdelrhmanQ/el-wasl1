<div dir="rtl">

# nAcademy — نظام إدارة أكاديمية رياضية متعددة الفروع

موقع ثابت (Static Site) مبني بـ **Vanilla JS + HTML + CSS** فوق **Firebase (Firestore + Auth)**، ومستضاف على **Vercel**.

## بنية المشروع

```
V1 after S/
├── index.html              ← صفحة التطبيق الوحيدة (الواجهة)
├── style.css               ← كل تنسيقات الموقع
├── server.js               ← طبقة البيانات (Firebase + Firestore + helpers)  ⚠ تعمل في المتصفح
├── main.js                 ← منطق الواجهة (تنقّل، نماذج، جداول، تقارير، طباعة)
├── vercel.json             ← إعدادات النشر على Vercel
├── package.json            ← سكربت build فارغ (الموقع ثابت بلا خطوة بناء)
├── firestore.rules         ← قواعد أمان Firestore (تُرفع من Firebase Console)
├── firestore.indexes.json  ← الفهارس المركّبة المطلوبة عند تثبيت جهاز على فرع
├── src/                    ← الشعار والأيقونة
├── vendor/                 ← نسخ محلية من Firebase SDK + qrcode (مع fallback للـ CDN)
└── dev/                    ← أدوات تطوير لا تُنشر مع الموقع
    └── firebase-loadtest.js   ← سكربت اختبار حِمل k6 (للتطوير فقط)
```

> **ترتيب تحميل السكربتات في `index.html` لازم يفضل كما هو:**
> `Firebase SDK → server.js → main.js`

## التشغيل محلياً

```bash
npx serve .
# أو
npm start
```

## النشر على Vercel

الموقع ثابت — مفيش خطوة بناء حقيقية. `package.json` بيوفّر سكربت `build` لا يفعل شيئاً
حتى يمر أمر `npm run build` الموجود في `vercel.json` بسلام.

## ⚠️ إجراءات أمان مطلوبة منك

1. **غيّر كلمة مرور حساب الأدمن فوراً.** كانت مكتوبة بنصّها داخل `firebase-loadtest.js`
   (وكمان كلمة ضعيفة). تم حذفها من الملف، لكن لازم تغيّرها من Firebase Console
   لأنها كانت مكشوفة. اختر كلمة قوية وفعّل التحقق بخطوتين لو متاح.

2. **بريد الأدمن مكرّر في مكانين** — `main.js` (ثابت `ADMIN_EMAILS`) و`firestore.rules`
   (دالة `isAdmin`). عند إضافة أدمن جديد لازم تحدّث الاثنين معاً.

3. **مفتاح `apiKey` في `server.js` ليس سرّاً** — ده طبيعي ومقصود في تطبيقات Firebase
   على الويب، والحماية الفعلية في `firestore.rules`. مش محتاج تخفيه.

## ملاحظات

- ملفات `server-local.log` و`.claude/` كانت ضمن الحزمة بالغلط (آثار تطوير محلية) وتم استبعادها.
- أُضيف `.gitignore` لمنع رفع تلك الملفات (واللوجات والأسرار) مستقبلاً.

</div>
