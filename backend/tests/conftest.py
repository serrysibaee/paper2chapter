import os
import tempfile
from pathlib import Path

import pymupdf
import pytest

os.environ["LLM_PROVIDER"] = "mock"  # never call paid APIs from tests
os.environ["LLM_MODEL"] = "mock"
os.environ["SANDBOX_BACKEND"] = "subprocess"
# isolated data dir; must be set before app.config is imported
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="p2c-test-")

PAGE1 = """
<h1 style="font-size:22px">Softmax Weighting for Robust Averaging</h1>
<p>Jane Doe, John Roe</p>
<h2>Abstract</h2>
<p>We study averaging values with weights produced by a softmax over learned scores.
We show that this weighting improves robustness on three benchmarks [1].</p>
<h2>1 Introduction</h2>
<p>Combining several noisy estimates is a classic problem [2]. A weighted average assigns
each estimate a non-negative weight; the weights sum to one. We propose computing the weights
with a softmax over relevance scores, which keeps them positive and differentiable [3].</p>
<h2>2 Method</h2>
<p>Given scores z_i, the weights are</p>
<p style="text-align:center">w_i = exp(z_i) / sum_j exp(z_j) (1)</p>
<p>and the output is y = sum_i w_i v_i (2). Table 1 lists the results.</p>
"""

PAGE2 = """
<h2>3 Results</h2>
<p>Table 1: Accuracy on three benchmarks.</p>
<table border="1" style="border-collapse:collapse">
<tr><th>Method</th><th>A</th><th>B</th><th>C</th></tr>
<tr><td>Mean</td><td>71.2</td><td>65.0</td><td>80.1</td></tr>
<tr><td>Softmax</td><td>74.8</td><td>69.3</td><td>82.5</td></tr>
</table>
<p>Softmax weighting is best on all benchmarks.</p>
"""

PAGE3 = """
<h2>References</h2>
<p>[1] A. Author. Robust estimation with learned weights. Journal of Examples, 2020.</p>
<p>[2] B. Builder. Combining estimates: a survey of averaging methods. Survey Press, 2018.</p>
<p>[3] C. Coder. Differentiable selection with the softmax function. Proc. ICML, 2019.</p>
"""


def make_sample_pdf(path: Path) -> Path:
    doc = pymupdf.open()
    for html in (PAGE1, PAGE2):
        page = doc.new_page()
        page.insert_htmlbox(pymupdf.Rect(60, 60, 540, 560), html)
    # page with a vector "figure" + caption, then references
    page = doc.new_page()
    shape = page.new_shape()
    shape.draw_rect(pymupdf.Rect(150, 80, 450, 280))
    shape.draw_circle(pymupdf.Point(300, 180), 60)
    shape.draw_line(pymupdf.Point(150, 80), pymupdf.Point(450, 280))
    shape.finish(color=(0, 0, 0), fill=(0.8, 0.85, 1.0), width=1.5)
    shape.commit()
    page.insert_htmlbox(pymupdf.Rect(150, 290, 450, 320), "<p>Figure 1: Softmax weights for three scores.</p>")
    page.insert_htmlbox(pymupdf.Rect(60, 340, 540, 760), PAGE3)
    doc.save(path)
    doc.close()
    return path


@pytest.fixture(scope="session")
def sample_pdf(tmp_path_factory) -> Path:
    return make_sample_pdf(tmp_path_factory.mktemp("pdf") / "sample.pdf")
