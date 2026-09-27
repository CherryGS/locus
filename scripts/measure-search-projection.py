"""Bounded SQLite common-column versus full-retained-payload probe.

The caller supplies only its newly initialized temporary search scale library.
This fixture uses the actual Civitai table and supported selected-column layout.
It is unmounted, so it never adds another Entity or affects exhaustive hit counts.
"""
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import time

database = Path(sys.argv[1]).resolve(strict=True)
fixture = database.parent.parent
if fixture.parent != Path(tempfile.gettempdir()).resolve() or not fixture.name.startswith("locus-entity-scale-"):
    raise ValueError("Expected an isolated search scale fixture")
component = bytes.fromhex("01992853c1237000b000000000000001")
file = {"id": 3, "name": "selected.safetensors", "type": "Model", "hashes": {"BLAKE3": "0" * 64}}
version = {"id": 2, "modelId": 1, "name": "Selected version", "files": [file]}
payload = json.dumps({"version": 1, "observation": "01992853-c123-7000-b000-000000000002", "basis": list(component), "examples": [], "snapshot": {"model": {"id": 1, "name": "Model", "type": "Checkpoint", "tags": [], "modelVersions": [version], "retainedExtra": "x" * (4 * 1024 * 1024)}, "lookup": version, "matched_version": 2, "matched_file": 3, "blake3": "0" * 64}})
with sqlite3.connect(database) as connection:
    connection.execute("INSERT INTO locus_civitai_comp_snapshot(id,revision,model,matched_version,matched_file,payload,q_model_id,q_model_name,q_model_type,q_model_tags,q_version_id,q_version_name,q_file_id,q_file_name,q_file_type) VALUES(?,0,'1','2','3',?,'1','Model','Checkpoint','[]','2','Selected version','3','selected.safetensors','Model')", (component, payload))
    common = "SELECT q_projection_error,q_model_id,q_model_name,q_model_type,q_model_description,q_model_tags,q_creator,q_version_id,q_version_name,q_version_description,q_base_model,q_file_id,q_file_name,q_file_type,q_file_format,q_file_fp,q_file_size FROM locus_civitai_comp_snapshot WHERE id=?"
    retained = "SELECT payload FROM locus_civitai_comp_snapshot WHERE id=?"
    def measure(query, decode):
        start = time.perf_counter()
        for _ in range(100):
            row = connection.execute(query, (component,)).fetchone()
            if decode:
                json.loads(row[0])
        return (time.perf_counter() - start) * 1000
    print(json.dumps({"retainedPayloadBytes": len(payload.encode()), "iterations": 100, "commonColumnsMs": measure(common, False), "fullPayloadReadAndDecodeMs": measure(retained, True), "commonQueryPlan": connection.execute("EXPLAIN QUERY PLAN " + common, (component,)).fetchall(), "qualification": "warm local SQLite/Python probe, actual Civitai table; not a Rust throughput promise or end-to-end benchmark"}))
    connection.commit()
