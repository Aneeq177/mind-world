import os
import json
from dotenv import load_dotenv

load_dotenv()

from supabase import create_client

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_KEY")

if not url or not key:
    print("Missing Supabase credentials")
    exit(1)

supabase = create_client(url, key)

def patch_user_ids():
    print("Checking for team conversations...")
    
    # Check if there are any conversations missing a user_id
    res = supabase.table("conversations")\
        .select("id, user_id, visibility, title")\
        .eq("visibility", "team")\
        .execute()
        
    convs = res.data or []
    print(f"Found {len(convs)} team conversations.")
    
    missing_user_id_convs = [c for c in convs if not c.get("user_id")]
    
    if not missing_user_id_convs:
        print("No team conversations are missing a user_id. Data integrity looks good!")
    else:
        print(f"Found {len(missing_user_id_convs)} conversations missing user_id. Attempting to fix...")
        fixed_count = 0
        for c in missing_user_id_convs:
            conv_id = c["id"]
            # Look up user_id in embeddings
            emb_res = supabase.table("embeddings").select("user_id").eq("conversation_id", conv_id).execute()
            if emb_res.data and emb_res.data[0].get("user_id"):
                found_user_id = emb_res.data[0]["user_id"]
                supabase.table("conversations").update({"user_id": found_user_id}).eq("id", conv_id).execute()
                print(f"Fixed {conv_id} with user_id {found_user_id}")
                fixed_count += 1
            else:
                print(f"Could not find user_id for {conv_id} in embeddings.")
        
        print(f"Fixed {fixed_count} out of {len(missing_user_id_convs)} conversations.")

if __name__ == "__main__":
    patch_user_ids()
