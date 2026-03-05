"""sas-tools — SAS 1.1 (Stick And String) parser, validator, and JSON converter.

Quick start::

    from sas_tools import parse_sas, sas_to_json, json_to_sas

    obj  = parse_sas(open("config.sas").read())
    text = sas_to_json(open("config.sas").read())
    sas  = json_to_sas({"host": "localhost", "port": 8080})
"""

from .parser      import SASParser, SASParseError, parse_sas
from .sas_to_json import sas_to_json, sas_to_object
from .json_to_sas import json_to_sas, JSONToSASError

__version__ = "1.1.0"
__all__ = [
    "SASParser",
    "SASParseError",
    "parse_sas",
    "sas_to_json",
    "sas_to_object",
    "json_to_sas",
    "JSONToSASError",
]
