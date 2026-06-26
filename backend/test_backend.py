import sys
import os
import json
import pandas as pd
import io

# Ensure the app package is in the Python search path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.database import Base, engine, SessionLocal
from app.models import DatasetRow, Settings
from app.services.llm import clean_label_response

def test_clean_label_response():
    print("Testing clean_label_response...")
    assert clean_label_response("Positive. The text is very good.") == "Positive"
    assert clean_label_response('"Negative"') == "Negative"
    assert clean_label_response("'Neutral'") == "Neutral"
    assert clean_label_response("spam") == "Spam"
    assert clean_label_response("This is a long explanation that doesn't start with a known label.") == "This is a long explanation tha"
    print("[OK] clean_label_response test passed!")

def test_database_and_csv():
    print("Testing database and CSV parsing...")
    # Setup test tables
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    
    try:
        # Clear tables
        db.query(DatasetRow).delete()
        db.query(Settings).delete()
        db.commit()
        
        # Test Settings
        settings = Settings(
            id=1,
            provider="ollama",
            base_url="http://localhost:11434",
            model="llama3",
            prompt="Classify sentiment: {text}",
            target_column="text_content"
        )
        db.add(settings)
        db.commit()
        
        saved_settings = db.query(Settings).first()
        assert saved_settings.provider == "ollama"
        assert saved_settings.model == "llama3"
        print("[OK] Settings database operations passed!")
        
        # Test CSV parsing mock
        csv_data = """id,text_content,category
1,I love this product!,retail
2,This is terrible,electronics
3,It is okay,clothing
"""
        df = pd.read_csv(io.StringIO(csv_data))
        assert len(df) == 3
        assert list(df.columns) == ["id", "text_content", "category"]
        
        # Test Row save
        db_rows = []
        for _, row in df.iterrows():
            row_dict = row.to_dict()
            db_row = DatasetRow(
                original_text=str(row_dict.get("text_content", "")),
                row_data=json.dumps(row_dict),
                status="pending"
            )
            db_rows.append(db_row)
            
        db.bulk_save_objects(db_rows)
        db.commit()
        
        # Check rows count
        assert db.query(DatasetRow).count() == 3
        pending_rows = db.query(DatasetRow).filter(DatasetRow.status == "pending").all()
        assert len(pending_rows) == 3
        print("[OK] CSV mock parsing and SQLite bulk insert passed!")
        
        # Test Manual label edit
        row_to_edit = db.query(DatasetRow).first()
        row_to_edit.ai_label = "Positive"
        row_to_edit.status = "completed"
        db.commit()
        
        edited_row = db.query(DatasetRow).filter(DatasetRow.id == row_to_edit.id).first()
        assert edited_row.ai_label == "Positive"
        assert edited_row.status == "completed"
        print("[OK] Manual row editing passed!")
        
        # Test CSV reconstruction for export
        all_rows = db.query(DatasetRow).all()
        records = []
        for r in all_rows:
            row_dict = json.loads(r.row_data)
            export_row = row_dict.copy()
            export_row["ai_label"] = r.ai_label
            export_row["ai_response"] = r.ai_response
            export_row["status"] = r.status
            records.append(export_row)
            
        export_df = pd.DataFrame(records)
        assert len(export_df) == 3
        assert "ai_label" in export_df.columns
        assert export_df.iloc[0]["ai_label"] == "Positive"
        assert pd.isna(export_df.iloc[1]["ai_label"]) or export_df.iloc[1]["ai_label"] is None
        print("[OK] Export DataFrame reconstruction passed!")
        
    finally:
        db.close()

def test_prompt_and_reasoning_handling():
    print("Testing prompt placeholder substitution and reasoning tags stripping...")
    from app.services.llm import build_batch_prompt, parse_and_validate_batch_response
    
    # Test {text} substitution in build_batch_prompt
    prompt = build_batch_prompt("Classify: {text}", "Positive, Negative", [{"id": "1", "text": "Sample"}])
    assert "the \"text\" field of each item in the input JSON array" in prompt
    assert "{text}" not in prompt
    print("[OK] Prompt template substitution passed!")
    
    # Test stripping of <think>...</think> tags in parse_and_validate_batch_response
    raw_response = "<think>Some reasoning thoughts</think> [{\"id\": \"1\", \"label\": \"Positive\"}]"
    result = parse_and_validate_batch_response(raw_response, [{"id": "1", "text": "Sample"}], "Positive, Negative")
    assert "1" in result
    assert result["1"]["label"] == "Positive"
    print("[OK] Reasoning tags stripping passed!")

if __name__ == "__main__":
    print("--- Starting Backend Tests ---")
    test_clean_label_response()
    test_database_and_csv()
    test_prompt_and_reasoning_handling()
    print("--- All Tests Passed Successfully! ---")
