"""Property-based test for unmodified identity forwarding (Task 6.2).

Feature: gateway-tool-access-control

This module implements correctness Property 8 from the design document:

    Property 8: The Agent Runtime forwards the same identity unmodified —
    for any user token value received by the Agent Runtime, the token attached
    to the outbound Gateway request is byte-for-byte equal to the received
    token; the runtime neither substitutes another identity nor mutates the
    token.

Validates: Requirements 7.3

Choice of property-tested surface
---------------------------------
The actual forwarding mechanism is the Bearer transport
``streamablehttp_client_with_bearer(url, token, timeout)`` in
``agentcore/streamable_http_bearer.py``. The Agent Runtime's
``build_mcp_client_for_token(token)`` forwards the resolved token straight into
this transport (``MCPClient(lambda: streamablehttp_client_with_bearer(url=...,
token=token))``) and ``resolve_user_token`` returns the inbound token without
mutation. Importing ``agent_runtime`` requires AWS runtime dependencies and is
not importable in this local environment, so this property test targets the
Bearer transport surface — the point at which the token is actually placed on
the outbound Gateway request as the ``Authorization`` header. Proving the
transport forwards the token byte-for-byte over a wide generated input space is
the strongest runnable guarantee of Property 8.

The wrapped ``streamablehttp_client`` is patched to capture the headers it is
called with (reusing the ``asyncio.run`` + ``unittest.mock.patch`` pattern from
``tests/test_streamable_http_bearer.py``), avoiding any real network or AWS
dependency.
"""

from __future__ import annotations

import asyncio
import os
import sys
from contextlib import asynccontextmanager
from unittest.mock import patch

from hypothesis import given, settings
from hypothesis import strategies as st

# Make the parent ``agentcore`` package importable when the test is run from an
# arbitrary working directory (the module under test sits one level up).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import streamable_http_bearer  # noqa: E402
from streamable_http_bearer import streamablehttp_client_with_bearer  # noqa: E402


# ---------------------------------------------------------------------------
# Test helper: drive the transport once, capturing the headers it forwards
# ---------------------------------------------------------------------------

_SENTINEL_CLIENT = object()


def _capture_forwarded_token(token: str) -> str:
    """Drive ``streamablehttp_client_with_bearer`` with ``token`` and return the
    token as it appears on the outbound ``Authorization`` header.

    The wrapped ``streamablehttp_client`` is patched to record the headers it is
    called with. The returned value is the substring following the single
    ``"Bearer "`` prefix — i.e. exactly what the Gateway would receive as the
    forwarded identity.
    """
    captured: dict = {}

    def _fake_streamablehttp_client(*args, **kwargs):
        captured["kwargs"] = kwargs

        @asynccontextmanager
        async def _cm():
            yield _SENTINEL_CLIENT

        return _cm()

    async def _inner():
        with patch.object(
            streamable_http_bearer,
            "streamablehttp_client",
            _fake_streamablehttp_client,
        ):
            async with streamablehttp_client_with_bearer(
                "https://gw.example/mcp", token
            ) as client:
                assert client is _SENTINEL_CLIENT
        return captured

    asyncio.run(_inner())

    header_value = captured["kwargs"]["headers"]["Authorization"]
    prefix = "Bearer "
    assert header_value.startswith(prefix)
    return header_value[len(prefix):]


# ---------------------------------------------------------------------------
# Generators: a wide range of token strings, including JWT-like shapes,
# tokens with dots, dashes, whitespace, and unicode.
# ---------------------------------------------------------------------------

# Arbitrary text tokens (includes whitespace, unicode, control chars, dots,
# dashes, empty string).
_arbitrary_tokens = st.text()

# JWT-like tokens: three base64url-ish segments separated by dots.
_b64url_alphabet = (
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
)
_segment = st.text(alphabet=_b64url_alphabet, min_size=1, max_size=40)
_jwt_like_tokens = st.builds(
    lambda a, b, c: f"{a}.{b}.{c}", _segment, _segment, _segment
)

# Tokens deliberately padded with leading/trailing whitespace and dot/dash
# clusters that a careless implementation might trim or normalize.
_edge_tokens = st.builds(
    lambda ws_lead, core, ws_trail: f"{ws_lead}{core}{ws_trail}",
    st.text(alphabet=" \t\n", max_size=4),
    st.text(alphabet=_b64url_alphabet + ".-_", min_size=1, max_size=30),
    st.text(alphabet=" \t\n", max_size=4),
)

_token_strategy = st.one_of(_arbitrary_tokens, _jwt_like_tokens, _edge_tokens)


# ---------------------------------------------------------------------------
# Property 8: the outbound Gateway token is byte-for-byte equal to the input.
# ---------------------------------------------------------------------------

# Feature: gateway-tool-access-control, Property 8: The Agent Runtime forwards the same identity unmodified
@settings(max_examples=200)
@given(token=_token_strategy)
def test_identity_forwarded_byte_for_byte_unmodified(token: str):
    """For any received token, the outbound Gateway token equals it exactly.

    No substitution of another identity and no mutation (trimming, casing,
    re-encoding) of the token is permitted.
    """
    forwarded = _capture_forwarded_token(token)
    assert forwarded == token
    # Byte-for-byte equality at the encoded level too (catches any silent
    # unicode normalization that preserves str equality but changes bytes).
    assert forwarded.encode("utf-8") == token.encode("utf-8")
