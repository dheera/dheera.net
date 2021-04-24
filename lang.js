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
      let [lang, text] = langStrings[i].split(":", 2);
      stringsByLang[lang] = text;
    }

    let language = acceptLanguageParser.pick(Object.keys(stringsByLang), acceptLanguage) || "en";
    // console.log(acceptLanguage, language);
    if(language in stringsByLang) return stringsByLang[language];

    return $1;
  });
};

let lang = (req, res, next) => {
  res.write_ = res.write;
  res.send_ = res.send;

  res.write = (content) => {
    res.write_(filtered(content, req.headers["accept-language"]));
  };

  res.send = (content) => {
    res.send_(filtered(content, req.headers["accept-language"]));
  };

  return next();
};

module.exports = lang;
