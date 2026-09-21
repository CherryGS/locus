"""Seed only a freshly initialized, isolated Entity scale fixture.

Run by the real-client scale consumer with `uv run python`. Setup is deliberately
outside measured enumeration; no API mutations or million retained UUID strings.
"""

import json
from pathlib import Path
import sqlite3
import sys
import tempfile


def main():
    database = Path(sys.argv[1]).resolve(strict=True)
    count = int(sys.argv[2])
    fixture = database.parent.parent
    if (
        database.name != "metadata.sqlite"
        or database.parent.name != "library"
        or not fixture.name.startswith("locus-entity-scale-")
        or fixture.parent != Path(tempfile.gettempdir()).resolve()
        or count < 1
        or count >= 2**62
    ):
        raise ValueError("Expected an isolated temporary scale database and positive Entity count")
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        if connection.execute("SELECT count(*) FROM locus_entities").fetchone()[0] != 0:
            raise ValueError("Scale fixture must start with no Entities")
        # Valid RFC UUIDv7 fields, deterministic unique sequence in the random tail.
        base = int.from_bytes(bytes.fromhex("01992853c12370008000000000000000"), "big")
        connection.executemany(
            "INSERT INTO locus_entities (id) VALUES (?)",
            (((base + position).to_bytes(16, "big"),) for position in range(count)),
        )
        tables = [row[0] for row in connection.execute(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        )]
        rows = {
            table: connection.execute('SELECT count(*) FROM "' + table.replace('"', '""') + '"').fetchone()[0]
            for table in tables
        }
        connection.commit()
    print(json.dumps({
        "entityCount": rows["locus_entities"], "totalDatabaseRows": sum(rows.values()),
        "tableRows": rows, "sqliteFixtureVersion": sqlite3.sqlite_version,
        "setup": "actual constrained Entity rows; no payload or membership rows; fixture setup excluded from timing",
    }))


if __name__ == "__main__":
    main()
