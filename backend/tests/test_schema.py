import pytest

from app.llm.schema import extract_json_text, strict_schema
from app.models import (
    ChapterOutline,
    ChapterSection,
    ChapterWrapUp,
    ChunkNotes,
    Exercise,
    PaperAnalysis,
    PracticeSet,
    PrimerSet,
)

LLM_SCHEMAS = [PaperAnalysis, ChunkNotes, ChapterOutline, ChapterSection, PrimerSet, ChapterWrapUp, PracticeSet, Exercise]


def _objects(node):
    if isinstance(node, dict):
        if node.get("type") == "object":
            yield node
        for v in node.values():
            yield from _objects(v)
    elif isinstance(node, list):
        for v in node:
            yield from _objects(v)


@pytest.mark.parametrize("model", LLM_SCHEMAS)
def test_schemas_are_strict_compatible(model):
    schema = strict_schema(model)
    text = str(schema)
    assert "$ref" not in text and "$defs" not in text and "'default'" not in text
    objs = list(_objects(schema))
    assert objs
    for obj in objs:
        assert obj["additionalProperties"] is False
        assert set(obj["required"]) == set(obj["properties"])


@pytest.mark.parametrize("model", LLM_SCHEMAS)
def test_all_fields_survive(model):
    # regression: fields named like JSON-Schema metadata ("title") must not be stripped
    props = strict_schema(model)["properties"]
    assert set(props) == set(model.model_fields)


@pytest.mark.parametrize("model", LLM_SCHEMAS)
def test_llm_schema_fields_have_no_defaults(model):
    # strict structured-output modes require every field; defaults would hide omissions
    for name, field in model.model_fields.items():
        assert field.is_required(), f"{model.__name__}.{name} has a default"


@pytest.mark.parametrize(
    "raw,expected",
    [
        ('{"a": 1}', '{"a": 1}'),
        ('```json\n{"a": 1}\n```', '{"a": 1}'),
        ('<think>hmm {"no": 0}</think>{"a": 1}', '{"a": 1}'),
        ('Sure! Here it is: {"a": 1} Hope this helps', '{"a": 1}'),
    ],
)
def test_extract_json_text(raw, expected):
    assert extract_json_text(raw) == expected
