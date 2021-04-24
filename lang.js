// Simple, no-fuss, minimalistic i18n framework for Express for simple websites
// where you don't need to have that many languages.
//
// by Dheera Venkatraman (https://dheera.net/)
//
// How to use:
// const lang = require("./lang");
// app.use(lang);
//
// Content:
// Simply put multiple language code anywhere in your HTML as [!lang0:text0|lang1:text1!], e.g.
// 
// <h1>[!en:Hello|es:Hola|zh:哈嘍!]</h1>
// [!en:This is a test|es:Esto es una prueba|zh:這是一個測試!]
// <img src="[!en:graphic_en.jpg|es:graphic_es.jpg|zh:graphic_zh.jpg!]">
// ...
//
// and that's it. It will read the user's Accept-Language header (based on their system setting) and
// pick the best-matched text from each set.
//
// This works by hijacking res.write and res.send, so it will work fine with templating frameworks like Nunjucks.

const acceptLanguageParser = require('accept-language-parser');

let filtered = (content, acceptLanguage) => {
  if(typeof(content) !== "string") return content; // binary data just passes through

  return content.replace(/\[!(.*?)!\]/sg, ($0, $1) => {
    let langStrings = $1.split("|");
    let stringsByLang = {};
    for(i in langStrings) {
      let index = langStrings[i].indexOf(":");
      if(!index) continue;
      let lang = langStrings[i].substr(0, index);
      let text = langStrings[i].substr(index+1);
      stringsByLang[lang] = text;
    }

    let language = acceptLanguageParser.pick(Object.keys(stringsByLang), acceptLanguage) || "en";
    // console.log(acceptLanguage, language);
    if(language in stringsByLang) return stringsByLang[language];
    if(Object.values(stringsByLang).length > 0) return Object.values(stringsByLang)[0];

    return $1;
  });
};

let lang = (req, res, next) => {

  res.write_ = res.write;
  res.send_ = res.send;

  res.write = (content) => {
    let acceptLanguage = req.headers["accept-language"];
    if(req.query.lang) { acceptLanguage = req.query.lang;res.cookie('lang', req.query.lang); }
    else if(req.cookies.lang) { acceptLanguage = req.cookies.lang; }
    res.write_(filtered(content, acceptLanguage));
  };

  res.send = (content) => {
    let acceptLanguage = req.headers["accept-language"];
    if(req.query.lang) { acceptLanguage = req.query.lang;res.cookie('lang', req.query.lang); }
    else if(req.cookies.lang) { acceptLanguage = req.cookies.lang; }
    res.send_(filtered(content, acceptLanguage));
  };

  return next();
};

module.exports = lang;
