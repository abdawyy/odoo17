from odoo import models, api

class HideAppsMenu(models.Model):
    _inherit = 'ir.ui.menu'

    @api.model
    def hide_apps(self):
        apps_menu = self.env.ref('base.menu_management', raise_if_not_found=False)
        if apps_menu:
            apps_menu.groups_id = [(6, 0, [])]

    @api.model
    def _register_hook(self):
        self.hide_apps()
        return super(HideAppsMenu, self)._register_hook()