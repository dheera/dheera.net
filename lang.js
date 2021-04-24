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
