import json
import os
import sys

def main():
    # Default paths
    base_dir = os.getcwd()
    input_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(base_dir, 'snippets.json')
    output_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(base_dir, 'snippets_extracted.json')

    if not os.path.exists(input_path):
        print(f"Error: Input file '{input_path}' not found.")
        sys.exit(1)

    try:
        with open(input_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        print(f"Error: Failed to parse JSON from '{input_path}': {e}")
        sys.exit(1)

    out = {}
    duplicates = {}

    for snippet_name, snippet_obj in data.items():
        prefix = snippet_obj.get('prefix')
        if not prefix:
            continue
        
        # Get first prefix
        if isinstance(prefix, list):
            if not prefix:
                continue
            raw_key = prefix[0]
        elif isinstance(prefix, str):
            raw_key = prefix
        else:
            continue

        # Transform key: \val -> \<val>
        # Check if it starts with backslash
        if raw_key.startswith('\\'):
            # raw_key is like "\zero"
            # we want "\<zero>"
            # slice from 1 to skip the first backslash
            key = f"\\<{raw_key[1:]}>"
        else:
            # If it doesn't start with \, just wrap it?
            # Or maybe prepend \<? 
            # Based on user request "add <>", assuming standard isabelle style \<name>
            key = f"\\<{raw_key}>"

        body = snippet_obj.get('body')
        if body is None:
            body_str = ""
        elif isinstance(body, list):
            body_str = "\n".join(body)
        elif isinstance(body, str):
            body_str = body
        else:
            body_str = str(body)

        if key in out:
            duplicates[key] = duplicates.get(key, 0) + 1
        
        out[key] = body_str

    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(out, f, indent=2, ensure_ascii=False)
        print(f"Successfully extracted {len(out)} snippets to '{output_path}'.")
        if duplicates:
            print(f"Warning: {len(duplicates)} duplicate keys encountered (last write wins). Examples: {list(duplicates.keys())[:5]}")
    except IOError as e:
        print(f"Error: Failed to write to '{output_path}': {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
