import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

const localOnlyExternalFontGuard = {
  postcssPlugin: "kforge-local-only-external-font-guard",
  AtRule: {
    import(rule) {
      if (/fonts\.(?:googleapis|gstatic)\.com/i.test(rule.params)) {
        rule.remove();
      }
    },
  },
};

export default {
  plugins: [localOnlyExternalFontGuard, tailwindcss(), autoprefixer()],
};
