from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]

class ContentStudioIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (ROOT / "index.html").read_text(encoding="utf-8")
        cls.js = (ROOT / "content-studio.js").read_text(encoding="utf-8")
        cls.css = (ROOT / "style.css").read_text(encoding="utf-8")

    def test_content_studio_navigation_and_page_exist(self):
        self.assertIn('href="#content-studio"', self.html)
        self.assertIn('id="content-studio"', self.html)
        self.assertIn('data-page="content-studio"', self.html)

    def test_content_studio_script_is_loaded(self):
        self.assertIn('src="content-studio.js"', self.html)

    def test_form_collects_platforms_and_brief(self):
        for field in ('businessName', 'industry', 'audience', 'offer', 'goal', 'topic', 'language', 'platforms'):
            with self.subTest(field=field):
                self.assertRegex(self.html, rf'name="{field}"')

    def test_live_generation_uses_same_origin_endpoint(self):
        self.assertIn('const EMAN_ENDPOINT = "/api/eman/content/drafts";', self.js)
        self.assertIn('credentials: "same-origin"', self.js)
        self.assertIn('review_required !== true', self.js)

    def test_no_provider_secret_is_embedded_in_browser_script(self):
        self.assertNotRegex(self.js, r'(?i)(sk-[A-Za-z0-9]{16,}|service_role|EMAN_AI_API_KEY\s*=)')
        self.assertIn("DEMO PREVIEW", self.js)
        self.assertIn("does not call an AI provider", self.js)

    def test_platform_limit_is_enforced_in_ui(self):
        self.assertIn("Choose no more than four platforms per request.", self.js)

    def test_responsive_studio_styles_exist(self):
        self.assertIn(".studio-layout", self.css)
        self.assertIn("@media (max-width: 900px)", self.css)

if __name__ == "__main__":
    unittest.main()
