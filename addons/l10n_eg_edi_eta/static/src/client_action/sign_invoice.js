/** @odoo-module **/

import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { registry } from "@web/core/registry";
import { _t } from "@web/core/l10n/translation";

async function actionGetDrive(env, action, type) {
    const { drive_id, sign_host: host } = action.params;
    const { orm, http, dialog, action: actionService } = env.services;

    let route = host;
    let key, method;
    if (type === "certificate") {
        route += "/hw_l10n_eg_eta/certificate";
        method = "set_certificate";
        key = "certificate";
    } else if (type === "sign") {
        route += "/hw_l10n_eg_eta/sign";
        method = "set_signature_data";
        key = "invoices";
    }

    let result = {};

    // ------------------------------------------------------------------
    // FIXED CODE: Parse the Odoo string into actual invoices first!
    // ------------------------------------------------------------------
    if (type === "sign" && action.params.invoices) {
        
        // 1. Convert Odoo's giant text string into a real JavaScript object
        const parsedInvoices = typeof action.params.invoices === "string" 
            ? JSON.parse(action.params.invoices) 
            : action.params.invoices;
            
        // Now this will correctly count the actual invoices (e.g., 2), not characters!
        const invoiceIds = Object.keys(parsedInvoices);
        let successCount = 0;
        let failedInvoices = [];  // Track failed invoices with error details
        
        console.log(` Found ${invoiceIds.length} actual invoices to process.`);
        
        // Loop through each invoice one by one
        for (let i = 0; i < invoiceIds.length; i++) {
            const invId = invoiceIds[i];
            console.log(` Processing invoice ${i + 1} of ${invoiceIds.length}...`);
            
            // Create an object with just THIS ONE invoice
            const singleInvoiceData = { [invId]: parsedInvoices[invId] };
            
            const singlePayload = {
                ...action.params,
                // Convert it BACK to a string so the USB Token can understand it
                invoices: JSON.stringify(singleInvoiceData)
            };
            
            try {
                let chunkResult = await http.post(route, singlePayload);
                
                if (chunkResult[key]) {
                    console.log(` Signature successful! Pushing to Odoo server immediately...`);
                    
                    // Upload this single invoice to Odoo right now!
                    await orm.call("l10n_eg_edi.thumb.drive", method, [[drive_id], chunkResult[key]]);
                    
                    successCount++;
                    console.log(` Invoice ${i + 1} is safely in Odoo!`);
                } else if (chunkResult.error) {
                    console.error(` Token error on invoice ${i + 1}:`, chunkResult.error);
                    failedInvoices.push({
                        id: invId,
                        error: chunkResult.error
                    });
                }
                
                // Pause for 2 seconds to let the USB token breathe
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (e) {
                console.error("Connection lost during loop", e);
                failedInvoices.push({
                    id: invId,
                    error: e.message || "Connection lost during signing"
                });
            }
        }
        
        console.log(`x Finished! Successfully pushed ${successCount} out of ${invoiceIds.length} invoices.`);
        
        // Build error details message
        let errorDetails = "";
        if (failedInvoices.length > 0) {
            errorDetails = "\n\nFailed invoices:\n";
            failedInvoices.forEach(failed => {
                errorDetails += `- Invoice ${failed.id}: ${failed.error}\n`;
            });
        }
        
        // Show success/failure message to user
        let messageBody = "";
        if (successCount === invoiceIds.length) {
            messageBody = _t("Success! All %s invoices have been signed and uploaded successfully.", invoiceIds.length);
        } else if (successCount > 0) {
            messageBody = _t("Partial success: %s out of %s invoices have been signed and uploaded successfully.", successCount, invoiceIds.length) + errorDetails;
        } else {
            messageBody = _t("Failed: None of the invoices could be signed. Please check the middleware and try again.") + errorDetails;
        }
        
        await dialog.add(AlertDialog, {
            body: messageBody,
            confirmLabel: _t("OK"),
        });
        
        actionService.doAction({
            type: "ir.actions.client",
            tag: "reload",
        });
        return;
        
    } else {
        // ------------------------------------------------------------------
        // ORIGINAL CODE
        // ------------------------------------------------------------------
        try {
            result = await http.post(route, action.params);
        } catch {
            dialog.add(AlertDialog, {
                body: _t("Error trying to connect to the middleware. Is the middleware running?"),
            });
            return;
        }
        
        if (result.error) {
            dialog.add(AlertDialog, { body: _t("Unexpected error: “%s”", result.error) });
        } else if (result[key]) {
            await orm.call("l10n_eg_edi.thumb.drive", method, [[drive_id], result[key]]);
            await dialog.add(AlertDialog, {
                body: type === "certificate" 
                    ? _t("Success! Certificate has been set up successfully.") 
                    : _t("Success! Invoices have been signed and uploaded successfully."),
                confirmLabel: _t("OK"),
            });
            actionService.doAction({ type: "ir.actions.client", tag: "reload" });
        }
    }
}

registry
    .category("actions")
    .add("action_get_drive_certificate", (env, action) =>
        actionGetDrive(env, action, "certificate")
    );
registry
    .category("actions")
    .add("action_post_sign_invoice", (env, action) => actionGetDrive(env, action, "sign"));