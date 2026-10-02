# MT CASA — نظام تحليل السائل المنوي (ويب)

> الاسم التجاري الجديد للمشروع (كان E-CASA Web) — تطوير Mohamed Tayea (m.tayea)

نسخة ويب حديثة من نظام E-CASA القديم (Desktop) — تشتغل أوفلاين كـ PWA، وترفع على GitHub Pages.

## المميزات الحالية (MVP v1)
- إدارة الحالات (مرضى): إضافة / تعديل / بحث / حذف
- إدارة الدراسات: كل مريض له عدة دراسات بتواريخ مختلفة
- إدخال النتائج يدويًا مع مقارنة تلقائية بمرجع WHO (أخضر/أحمر + PASSED/FAILED)
- حساب تلقائي: Count = Concentration × Volume، و Motile Ratio = PR + NP
- تقرير طباعة بالإنجليزية بنفس شكل تقرير E-CASA الأصلي
- التقاط صور Morphology وتسجيل فيديو Motility من كاميرا المجهر داخل المتصفح (getUserMedia + MediaRecorder)، وإرفاقها بالدراسة — تُحفظ أوفلاين في IndexedDB
- ظهور الصور المرفقة داخل التقرير المطبوع (حتى 6 صور)
- **التحليل الآلي للحركة (v3)**: تتبع الحيوانات المنوية في الفيديو (Background Subtraction + Nearest-Neighbor tracking) وحساب VCL/VSL/VAP/LIN/WOB/STR وتصنيف PR/NP/IM حسب WHO، مع رسم المسارات ملونة (أخضر/أصفر/أحمر) — OpenCV.js يشتغل أوفلاين بعد أول تحميل
- نسخ احتياطي / استيراد بصيغة JSON (يشمل الوسائط)
- يعمل أوفلاين بالكامل بعد أول تحميل (Service Worker + IndexedDB)

## التشغيل محليًا
أي سيرفر static يكفي:

```bash
cd ecasa-web
python -m http.server 8080
# افتح http://localhost:8080
```

> ملاحظة: فتح `index.html` مباشرة (file://) يشتغل لكن بدون Service Worker/أوفلاين — لازم HTTP.

## النشر على GitHub Pages
1. اعمل repo جديد على GitHub وارفع الملفات:
   ```bash
   git init
   git add .
   git commit -m "E-CASA Web MVP v1"
   git branch -M main
   git remote add origin https://github.com/USER/ecasa-web.git
   git push -u origin main
   ```
2. في المستودع: Settings → Pages → Source: Deploy from a branch → `main` / `root`
3. الموقع هيبقى على: `https://USER.github.io/ecasa-web/`

## بنية المشروع
```
ecasa-web/
├── index.html      # هيكل التطبيق
├── manifest.json   # إعدادات PWA (تثبيت على الجهاز)
├── sw.js           # Service Worker (تخزين أوفلاين)
├── icon.svg
├── css/style.css
└── js/
    ├── db.js       # قاعدة البيانات المحلية (IndexedDB) + مرجع WHO + القوالب
    ├── camera.js   # التقاط من كاميرا المجهر (getUserMedia + MediaRecorder)
    ├── analyze.js  # التحليل الآلي للحركة (OpenCV.js + تتبع + تصنيف WHO)
    ├── app.js      # الواجهات والتنقل والمنطق
    └── report.js   # مولّد التقرير للطباعة
```

## خريطة الطريق (Roadmap)
- [x] v1: حالات + دراسات + إدخال يدوي + تقارير + أوفلاين
- [x] v2: التقاط فيديو/صور من كاميرا المجهر عبر المتصفح (getUserMedia + MediaRecorder) + إرفاقها بالدراسة + ظهور الصور في التقرير
- [x] v3: تحليل آلي للحركة (VCL/VSL/VAP/LIN/WOB/STR + تصنيف PR/NP/IM) بـ OpenCV.js — زرار "تحليل حركة" على أي فيديو مرفق، والنتائج تتعبّى في الدراسة وتظهر في التقرير
- [x] v4: تحليل آلي للمورفولوجي — كشف رأس الحيوان في الصورة (threshold + fitEllipse)، قياس الطول/العرض بـ µm، نسبة الأكرازوم (الصبغة الأفتح)، تصنيف طبيعي/شاذ حسب مساحة مرجعية ± هامش خطأ + نسبة الطول/العرض + نطاق الأكرازوم، ورسم أخضر/أحمر — زرار «تحليل مورفولوجي» على أي صورة مرفقة والنتيجة تتعبّى في «طبيعية الشكل %»
- [ ] v5: مزامنة سحابية (Supabase/Firebase) — أوفلاين أولًا ثم رفع تلقائي عند عودة الشبكة
- [ ] v6: استيراد الأرشيف القديم من ملفات Access MDB (egycasa.mdb)
- [ ] v7: إحصائيات ومتابعة تطور Parameters عبر الدراسات (شارت)

## ملاحظات أمنية
- البيانات الطبية حساسة: قبل v5 كل البيانات على جهاز المستخدم فقط، والنسخ الاحتياطي JSON لازم يتخزن مشفرًا أو في مكان آمن.
- عند إضافة المزامنة السحابية: لازم تشفير على مستوى الحقل + صلاحيات مستخدمين.
