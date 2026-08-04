#!/bin/bash

# Navigate to the target project directory
cd "/Users/himanishpatnaik/Documents/Kaira Luxe Billing System/05_Development/kaira-luxe-billing" || {
    echo "Directory not found! Press any key to exit."
    read -n 1
    exit 1
}

# Run the search, excluding ignored folders, and output to project_files.txt
find . \
  -not -path "./node_modules/*" \
  -not -path "./dist/*" \
  -not -path "./.git/*" \
  -type f | sort > project_files.txt

echo "Successfully saved project file list to project_files.txt"